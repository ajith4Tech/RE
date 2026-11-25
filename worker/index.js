// The Ride — Cloudflare Worker + Durable Object backend for Live Vote mode.
//
// The Durable Object holds only:
//   - the current slot (the step id on screen, e.g. "q3") and phase
//   - vote tallies per step, by option id
//   - word-cloud answers (pending / approved / rejected by the moderator), each tied to its step
//   - the discussion timer, the voting countdown and a random round id
//   - the last command the moderator view sent to the projector (relayed, then forgotten)
//   - anonymous random voter ids, to allow one vote per phone per step (wiped on reset)
// No names, no IP addresses, no personal data.
import { isProfane } from "../public/js/profanity.js";

// idle = lobby, arrive = arriving at a stop, show = a screen without a vote, open / closed = voting,
// reveal = Stop 1's answer on screen
const PHASES = ["idle", "arrive", "show", "open", "closed", "reveal"];
const SLOT_RE = /^[A-Za-z0-9_-]{1,24}$/; // slots are step ids
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const MAX_WORDS = 600;
const WORDS_PER_PHONE = 3;
// Commands the moderator view can send to the projector (the projector does the work)
const COMMANDS = ["next", "back", "closeVote", "pause", "extend", "addWord", "key", "timer", "mode", "returnLive", "mute", "reset"];
const KEY_RE = /^[A-Da-d0-9]$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });
    if (url.pathname === "/v" || url.pathname === "/v/") return env.ASSETS.fetch(new URL("/vote", url));
    if (url.pathname === "/moderator/") return Response.redirect(new URL("/moderator", url), 301);
    if (url.pathname.startsWith("/api/")) return env.GAME.get(env.GAME.idFromName("main")).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

// ------------------------------------------------------------------ validation
/** Accepts one option id ("B"), or a list of distinct ids for pick-n (["owner", "fixer", "data"]). */
function validAnswer(a) {
  if (typeof a === "string") return ID_RE.test(a);
  if (Array.isArray(a)) return a.length >= 1 && a.length <= 10 && new Set(a).size === a.length && a.every((x) => typeof x === "string" && ID_RE.test(x));
  return false;
}

function addToTally(t, a) {
  t.n += 1;
  for (const id of Array.isArray(a) ? a : [a]) t.counts[id] = (t.counts[id] || 0) + 1;
}

const emptyTally = () => ({ n: 0, counts: {} });
const newRound = () => Math.random().toString(36).slice(2, 8);
const freshState = () => ({ slot: "intro", phase: "idle", round: newRound(), tallies: {}, words: [], wordSeq: 0, timer: { duration: 60, endsAt: null } });

// ------------------------------------------------------------------ Durable Object
export class Game {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.broadcastTimer = null;
    this.voterTimer = null;
    this.lastVoterSend = 0;
    this.cmd = null; // the last relayed moderator command (memory only)
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get("state");
      this.state = saved && saved.slot !== undefined ? { ...freshState(), ...saved } : freshState();
    });
  }

  /** The voting countdown for the step on screen (the projector is the clock; it sends its state with each step). */
  voteView() {
    const v = this.state.vote;
    if (!v || v.slot !== this.state.slot) return null;
    const remainingMs = v.locked ? 0 : v.paused || !v.endsAt ? v.left : Math.max(0, v.endsAt - Date.now());
    return { duration: v.duration, remainingMs, paused: !!v.paused, locked: !!v.locked, running: !!v.endsAt && !v.paused && !v.locked };
  }

  timerView() {
    const t = this.state.timer;
    if (!t?.endsAt) return { running: false, duration: t?.duration || 60, remainingMs: 0 };
    return { running: t.endsAt > Date.now(), duration: t.duration, remainingMs: Math.max(0, t.endsAt - Date.now()) };
  }

  // Approved answers for the question on screen, merged by text. Two-part clouds (dualcloud) keep each part separate.
  approvedWords() {
    const agg = {};
    for (const w of this.wordsHere()) {
      if (w.status !== "approved") continue;
      const k = `${w.part || ""}|${w.key}`;
      agg[k] = { text: w.text, n: (agg[k]?.n || 0) + 1, ...(w.part ? { part: w.part } : {}) };
    }
    return Object.values(agg);
  }

  /** Word-cloud entries for the step on screen (Q2 and Q7 are both clouds; each keeps its own). */
  wordsHere() {
    return this.state.words.filter((w) => w.slot === this.state.slot);
  }

  publicState(forPresenter) {
    const s = this.state;
    const tally = s.tallies[s.slot] || emptyTally();
    const out = {
      slot: s.slot,
      phase: s.phase,
      round: s.round,
      n: tally.n,
      riders: this.ctx.getWebSockets("voter").length, // phones connected right now (the lobby's "riders joined")
      timer: this.timerView(),
      vote: this.voteView(),
    };
    // Phones get the room's live result too, so after voting they see it fill as the big screen does
    if (forPresenter || ["open", "closed", "reveal"].includes(s.phase)) out.tally = tally;
    if (forPresenter) {
      out.words = this.approvedWords();
      out.pending = this.wordsHere().filter((w) => w.status === "pending").length;
      if (this.cmd) out.cmd = { ...this.cmd, age: Date.now() - this.cmd.at };
    }
    return out;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket" }, 426);
      const role = url.searchParams.get("role") === "presenter" ? "presenter" : "voter";
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [role]);
      pair[1].send(JSON.stringify({ type: "state", state: this.publicState(role === "presenter") }));
      if (role === "voter") this.scheduleBroadcast(false); // the presenter's "riders joined" count
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/api/state" && request.method === "GET") return json(this.publicState(url.searchParams.get("role") === "presenter"));
    if (request.method === "POST" && ["/api/vote", "/api/word", "/api/admin"].includes(path)) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (path === "/api/vote") return json(...(await this.vote(body)));
      if (path === "/api/word") return json(...(await this.word(body)));
      return json(...(await this.admin(body)));
    }
    return json({ error: "not found" }, 404);
  }

  validVoter(v) {
    return typeof v === "string" && v.length >= 8 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
  }


  async vote(body) {
    const { voter, slot, answer } = body || {};
    const s = this.state;
    if (!this.validVoter(voter)) return [{ error: "bad voter" }, 400];
    if (!validAnswer(answer)) return [{ error: "bad answer" }, 400];
    if (slot !== s.slot || s.phase !== "open") return [{ ok: false, reason: "closed", state: this.publicState(false) }, 409];
    const key = `v:${s.round}:${s.slot}:${voter}`;
    const previous = await this.ctx.storage.get(key);
    if (previous) return [{ ok: true, duplicate: true, answer: previous, state: this.publicState(false) }, 200];
    addToTally((s.tallies[s.slot] = s.tallies[s.slot] || emptyTally()), answer);
    this.ctx.storage.put(key, answer);
    this.ctx.storage.put("state", s);
    this.scheduleBroadcast(false);
    return [{ ok: true, answer, state: this.publicState(false) }, 200];
  }

  // Word cloud: up to 3 short answers per phone, filtered, then queued for the moderator.
  // Two-part clouds (dualcloud) send { entries: [{ part, text }, …] }: one answer per part per phone,
  // all sent together, and each queued entry keeps its part so the moderator sees which cloud it is for.
  async word(body) {
    const { voter, slot } = body || {};
    const s = this.state;
    if (!this.validVoter(voter)) return [{ error: "bad voter" }, 400];
    const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
    const dual = Array.isArray(body?.entries);
    const entries = dual ? body.entries.map((e) => ({ part: e?.part, text: clean(e?.text) })) : [{ part: null, text: clean(body?.text) }];
    if (dual && (entries.length < 1 || entries.length > 2 || new Set(entries.map((e) => e.part)).size !== entries.length || !entries.every((e) => typeof e.part === "string" && ID_RE.test(e.part))))
      return [{ error: "bad entries" }, 400];
    if (!entries.every((e) => e.text && [...e.text].length <= 40)) return [{ error: "1–40 characters" }, 400];
    if (slot !== s.slot || s.phase !== "open") return [{ ok: false, reason: "closed" }, 409];
    const rude = entries.find((e) => isProfane(e.text));
    if (rude) return [{ ok: false, reason: "rephrase", ...(dual ? { part: rude.part } : {}) }, 200];
    // Limits and the "answers in" count are per step: a phone that answered Q2 counts again at Q7.
    const here = this.wordsHere();
    const mine = here.filter((w) => w.voter === voter).length;
    if (dual ? entries.some((e) => here.some((w) => w.voter === voter && w.part === e.part)) : mine >= WORDS_PER_PHONE) return [{ ok: false, reason: "limit" }, 200];
    if (s.words.length + entries.length > MAX_WORDS) return [{ ok: false, reason: "full" }, 200];
    for (const e of entries)
      s.words.push({ id: ++s.wordSeq, slot: s.slot, text: e.text, key: e.text.toLowerCase(), status: "pending", voter, ...(e.part ? { part: e.part } : {}) });
    const t = (s.tallies[s.slot] = s.tallies[s.slot] || emptyTally());
    if (!mine) t.n += 1;
    this.ctx.storage.put("state", s);
    this.scheduleBroadcast(false);
    return [{ ok: true, count: mine + entries.length }, 200];
  }

  async admin(body) {
    const pin = String(this.env.ADMIN_PIN || "");
    if (!pin) return [{ error: "ADMIN_PIN is not configured on the server" }, 500];
    if (!body || String(body.pin) !== pin) return [{ error: "wrong PIN" }, 401];
    const s = this.state;
    switch (body.action) {
      case "check":
        return [{ ok: true, state: this.publicState(true) }, 200];
      case "reset": {
        const round = s.round;
        await this.ctx.storage.deleteAll();
        this.state = freshState();
        if (this.state.round === round) this.state.round = newRound();
        await this.ctx.storage.put("state", this.state);
        this.scheduleBroadcast(true);
        return [{ ok: true, state: this.publicState(true) }, 200];
      }
      case "set": {
        // Ignore stale updates: a slow request the projector already gave up on must not undo a newer one.
        const seq = Number(body.seq) || 0;
        if (seq && seq < (s.lastSeq || 0)) return [{ ok: true, ignored: true, state: this.publicState(true) }, 200];
        if (seq) s.lastSeq = seq;
        const slot = String(body.slot ?? "");
        if (!SLOT_RE.test(slot)) return [{ error: "bad slot" }, 400];
        if (!PHASES.includes(body.phase)) return [{ error: "bad phase" }, 400];
        const changed = s.slot !== slot || s.phase !== body.phase;
        // Moving on to another step: entries the moderator never handled are cleared ("expired"),
        // so they can't turn up in a later word cloud's queue. The discussion timer stops too.
        if (s.slot !== slot) {
          for (const w of s.words) if (w.status === "pending" && w.slot !== slot) w.status = "expired";
          s.timer = { duration: s.timer?.duration || 60, endsAt: null };
        }
        s.slot = slot;
        s.phase = body.phase;
        // The voting countdown, as the projector has it right now
        const before = this.voteView();
        const v = body.vote;
        if (v && typeof v === "object") {
          const left = Math.max(0, Math.min(900000, Number(v.remainingMs) || 0));
          const duration = Math.max(1, Math.min(900, Number(v.duration) || 30));
          s.vote = { slot, duration, left, paused: !!v.paused, locked: !!v.locked, endsAt: v.paused || v.locked ? null : Date.now() + left };
        } else if (s.vote?.slot !== slot) s.vote = null;
        const after = this.voteView();
        // Phones hear about a countdown that started, paused, locked or jumped (extended); not about it ticking down
        const voteChanged = !before !== !after || (!!after && (after.paused !== before.paused || after.locked !== before.locked || Math.abs(after.remainingMs - before.remainingMs) > 1500));
        await this.ctx.storage.put("state", s);
        if (changed || voteChanged) this.scheduleBroadcast(true);
        return [{ ok: true, state: this.publicState(true) }, 200];
      }
      case "timer": {
        const duration = Math.max(5, Math.min(900, Number(body.duration) || 60));
        s.timer = body.cmd === "start" ? { duration, endsAt: Date.now() + duration * 1000 } : { duration, endsAt: null };
        await this.ctx.storage.put("state", s);
        this.scheduleBroadcast(true);
        return [{ ok: true, state: this.publicState(true) }, 200];
      }
      case "command": {
        // The moderator view (on a phone) drives the projector: relayed straight to it, run there once.
        if (!COMMANDS.includes(body.cmd)) return [{ error: "bad command" }, 400];
        if (body.cmd === "key" && !KEY_RE.test(String(body.key || ""))) return [{ error: "bad key" }, 400];
        // Ids only ever grow (clock-based), even if this object restarts and forgets the last one
        const c = { id: Math.max(Date.now(), (this.cmd?.id || 0) + 1), cmd: body.cmd, at: Date.now() };
        if (body.arg != null) c.arg = Math.max(-600, Math.min(600, Number(body.arg) || 0));
        if (body.cmd === "key") c.key = String(body.key);
        if (body.cmd === "addWord") c.text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 40);
        this.cmd = c;
        const msg = JSON.stringify({ type: "cmd", cmd: { ...c, age: 0 } });
        let sent = 0;
        for (const ws of this.ctx.getWebSockets("presenter")) {
          try { ws.send(msg); sent++; } catch {}
        }
        return [{ ok: true, sent }, 200];
      }
      case "words": // the moderator queue: this question only
        return [{ ok: true, words: this.wordsHere().map(({ voter, ...w }) => w) }, 200];
      case "word": {
        const w = s.words.find((x) => x.id === Number(body.id));
        if (!w || !["approved", "rejected", "pending"].includes(body.status)) return [{ error: "bad word" }, 400];
        w.status = body.status;
        await this.ctx.storage.put("state", s);
        this.scheduleBroadcast(false);
        return [{ ok: true }, 200];
      }
      case "addWord": {
        const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 40);
        if (!text) return [{ error: "empty" }, 400];
        const part = typeof body.part === "string" && ID_RE.test(body.part) ? body.part : null;
        s.words.push({ id: ++s.wordSeq, slot: s.slot, text, key: text.toLowerCase(), status: "approved", voter: "presenter", ...(part ? { part } : {}) });
        await this.ctx.storage.put("state", s);
        this.scheduleBroadcast(false);
        return [{ ok: true }, 200];
      }
    }
    return [{ error: "unknown action" }, 400];
  }

  // Presenters get tally updates every 250 ms at most. Phones get every slot/phase/timer change at once,
  // and the live tally at most once a second (so after voting they see the room's result fill).
  scheduleBroadcast(includeVoters) {
    if (includeVoters) {
      this.lastVoterSend = Date.now();
      this.sendTo("voter", this.publicState(false));
      this.sendTo("presenter", this.publicState(true));
      return;
    }
    if (!this.broadcastTimer)
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        this.sendTo("presenter", this.publicState(true));
      }, 250);
    if (!this.voterTimer && this.state.phase === "open")
      this.voterTimer = setTimeout(() => {
        this.voterTimer = null;
        this.lastVoterSend = Date.now();
        this.sendTo("voter", this.publicState(false));
      }, Math.max(0, 1000 - (Date.now() - this.lastVoterSend)));
  }

  sendTo(tag, state) {
    const msg = JSON.stringify({ type: "state", state });
    for (const ws of this.ctx.getWebSockets(tag)) {
      try {
        ws.send(msg);
      } catch {}
    }
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") {
      try {
        ws.send("pong");
      } catch {}
    }
  }
  async webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {}
    this.scheduleBroadcast(false);
  }
  async webSocketError() {}
}
