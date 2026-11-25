// The Ride — Cloudflare Worker + Durable Object backend for Live Vote mode.
//
// The Durable Object holds only:
//   - the current slot ("<route index>" or "<route index>.<sub>") and phase
//   - vote tallies per slot, by option id (never by translated text)
//   - word-cloud answers (pending / approved / rejected by the moderator)
//   - how many phones use each language, the discussion timer, a random round id
//   - anonymous random voter ids, to allow one vote per phone (wiped on reset)
// No names, no IP addresses, no personal data.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { partStrings } from "../public/js/i18n.js";
import { isProfane } from "../public/js/profanity.js";

const PHASES = ["idle", "arrive", "open", "closed", "reveal", "info", "end"];
const SLOT_RE = /^\d{1,2}(\.[A-Za-z0-9_-]{1,12})?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const LANG_RE = /^[a-z]{2,3}$|^other:[\p{L}\p{M} ()'-]{1,40}$/u;
const MAX_WORDS = 600;
const WORDS_PER_PHONE = 3;

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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });
    if (url.pathname === "/v" || url.pathname === "/v/") return env.ASSETS.fetch(new URL("/vote", url));
    if (url.pathname === "/moderator/") return Response.redirect(new URL("/moderator", url), 301);
    if (url.pathname === "/api/translate" && request.method === "POST") return translate(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return env.GAME.get(env.GAME.idFromName("main")).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

// ------------------------------------------------------------------ validation
/** Accepts: "id" | ["id", …] | { key: "id", … } | { key: number, … } */
function validAnswer(a) {
  if (typeof a === "string") return ID_RE.test(a);
  if (Array.isArray(a)) return a.length <= 10 && new Set(a).size === a.length && a.every((x) => typeof x === "string" && ID_RE.test(x));
  if (a && typeof a === "object") {
    const entries = Object.entries(a);
    if (!entries.length || entries.length > 10 || !entries.every(([k]) => ID_RE.test(k))) return false;
    if (entries.every(([, v]) => typeof v === "string" && ID_RE.test(v))) return true;
    return entries.every(([, v]) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e8);
  }
  return false;
}

function addToTally(t, a) {
  t.n += 1;
  if (typeof a === "string") t.counts[a] = (t.counts[a] || 0) + 1;
  else if (Array.isArray(a)) {
    a.forEach((id, i) => {
      t.counts[id] = (t.counts[id] || 0) + 1;
      t.pos[id] = (t.pos[id] || 0) + i + 1; // rank: average position = pos / counts
    });
  } else {
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "number") (t.nums[k] = t.nums[k] || []).length < 2000 && t.nums[k].push(v);
      else t.counts[`${k}:${v}`] = (t.counts[`${k}:${v}`] || 0) + 1; // match / multi-poll: "item:bucket"
    }
  }
}

const emptyTally = () => ({ n: 0, counts: {}, pos: {}, nums: {} });
const newRound = () => Math.random().toString(36).slice(2, 8);
const freshState = () => ({ slot: "0", phase: "idle", round: newRound(), tallies: {}, langs: {}, words: [], wordSeq: 0, timer: { duration: 60, endsAt: null } });

// ------------------------------------------------------------------ Durable Object
export class Game {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.broadcastTimer = null;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get("state");
      this.state = saved && saved.slot !== undefined ? { ...freshState(), ...saved } : freshState();
    });
  }

  timerView() {
    const t = this.state.timer;
    if (!t?.endsAt) return { running: false, duration: t?.duration || 60, remainingMs: 0 };
    return { running: t.endsAt > Date.now(), duration: t.duration, remainingMs: Math.max(0, t.endsAt - Date.now()) };
  }

  approvedWords() {
    const agg = {};
    for (const w of this.state.words) if (w.status === "approved") agg[w.key] = { text: w.text, n: (agg[w.key]?.n || 0) + 1 };
    return Object.values(agg);
  }

  publicState(forPresenter) {
    const s = this.state;
    const tally = s.tallies[s.slot] || emptyTally();
    const out = {
      slot: s.slot,
      phase: s.phase,
      round: s.round,
      n: tally.n,
      languages: Object.keys(s.langs).filter((l) => s.langs[l] > 0).length,
      timer: this.timerView(),
    };
    if (forPresenter || ["closed", "reveal", "end"].includes(s.phase)) {
      const { nums, ...rest } = tally;
      out.tally = { ...rest, nums: summariseNums(nums) };
    }
    if (forPresenter) {
      out.langs = s.langs;
      out.words = this.approvedWords();
      out.pending = s.words.filter((w) => w.status === "pending").length;
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

  async noteLanguage(voter, lang) {
    if (typeof lang !== "string" || !LANG_RE.test(lang)) return;
    const s = this.state;
    const key = `l:${s.round}:${voter}`;
    const prev = await this.ctx.storage.get(key);
    if (prev === lang) return;
    if (prev && s.langs[prev]) s.langs[prev] -= 1;
    s.langs[lang] = (s.langs[lang] || 0) + 1;
    this.ctx.storage.put(key, lang);
  }

  async vote(body) {
    const { voter, slot, answer, lang } = body || {};
    const s = this.state;
    if (!this.validVoter(voter)) return [{ error: "bad voter" }, 400];
    if (!validAnswer(answer)) return [{ error: "bad answer" }, 400];
    if (slot !== s.slot || s.phase !== "open") return [{ ok: false, reason: "closed", state: this.publicState(false) }, 409];
    const key = `v:${s.round}:${s.slot}:${voter}`;
    const previous = await this.ctx.storage.get(key);
    if (previous) return [{ ok: true, duplicate: true, answer: previous, state: this.publicState(false) }, 200];
    addToTally((s.tallies[s.slot] = s.tallies[s.slot] || emptyTally()), answer);
    await this.noteLanguage(voter, lang);
    this.ctx.storage.put(key, answer);
    this.ctx.storage.put("state", s);
    this.scheduleBroadcast(false);
    return [{ ok: true, answer, state: this.publicState(false) }, 200];
  }

  // Word cloud: up to 3 short answers per phone, filtered, then queued for the moderator.
  async word(body) {
    const { voter, slot, lang } = body || {};
    const s = this.state;
    if (!this.validVoter(voter)) return [{ error: "bad voter" }, 400];
    const text = String(body?.text || "").replace(/\s+/g, " ").trim();
    if (!text || [...text].length > 40) return [{ error: "1–40 characters" }, 400];
    if (slot !== s.slot || s.phase !== "open") return [{ ok: false, reason: "closed" }, 409];
    if (isProfane(text)) return [{ ok: false, reason: "rephrase" }, 200];
    const mine = s.words.filter((w) => w.voter === voter).length;
    if (mine >= WORDS_PER_PHONE) return [{ ok: false, reason: "limit" }, 200];
    if (s.words.length >= MAX_WORDS) return [{ ok: false, reason: "full" }, 200];
    s.words.push({ id: ++s.wordSeq, text, key: text.toLowerCase(), status: "pending", voter, lang: typeof lang === "string" ? lang.slice(0, 48) : "" });
    await this.noteLanguage(voter, lang);
    const t = (s.tallies[s.slot] = s.tallies[s.slot] || emptyTally());
    if (!mine) t.n += 1;
    this.ctx.storage.put("state", s);
    this.scheduleBroadcast(false);
    return [{ ok: true, count: mine + 1 }, 200];
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
        if (s.slot.split(".")[0] !== slot.split(".")[0]) s.timer = { duration: s.timer?.duration || 60, endsAt: null };
        s.slot = slot;
        s.phase = body.phase;
        await this.ctx.storage.put("state", s);
        if (changed) this.scheduleBroadcast(true);
        return [{ ok: true, state: this.publicState(true) }, 200];
      }
      case "timer": {
        const duration = Math.max(5, Math.min(900, Number(body.duration) || 60));
        s.timer = body.cmd === "start" ? { duration, endsAt: Date.now() + duration * 1000 } : { duration, endsAt: null };
        await this.ctx.storage.put("state", s);
        this.scheduleBroadcast(true);
        return [{ ok: true, state: this.publicState(true) }, 200];
      }
      case "words":
        return [{ ok: true, words: s.words.map(({ voter, ...w }) => w) }, 200];
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
        s.words.push({ id: ++s.wordSeq, text, key: text.toLowerCase(), status: "approved", voter: "presenter", lang: "" });
        await this.ctx.storage.put("state", s);
        this.scheduleBroadcast(false);
        return [{ ok: true }, 200];
      }
    }
    return [{ error: "unknown action" }, 400];
  }

  // Presenters get tally updates (throttled). Phones only when slot/phase/timer change.
  scheduleBroadcast(includeVoters) {
    if (includeVoters) {
      this.sendTo("voter", this.publicState(false));
      this.sendTo("presenter", this.publicState(true));
      return;
    }
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.sendTo("presenter", this.publicState(true));
    }, 250);
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
  }
  async webSocketError() {}
}

/** Estimate sliders: send medians (and counts) instead of every number. */
function summariseNums(nums) {
  const out = {};
  for (const [k, list] of Object.entries(nums || {})) {
    const a = [...list].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    out[k] = { n: a.length, median: a.length ? (a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2) : null };
  }
  return out;
}

// ------------------------------------------------------------------ "Other language" AI translation
// The phone sends { language: "Konkani", part: "ui" | <route id> }. The Worker
// translates that part of content/en.json with Claude. The API key is a Worker
// secret (ANTHROPIC_API_KEY) and never reaches the browser. Results are cached
// per language + part; identical requests in flight share one API call.
// Switch the feature off with "otherLanguageAI": false in content/en.json.
const memo = new Map();
let windowStart = 0;
let callsInWindow = 0;

async function translate(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const en = await (await env.ASSETS.fetch(new URL("/content/en.json", request.url))).json();
  if (!en.config?.otherLanguageAI) return json({ error: "AI translation is switched off" }, 404);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI translation is not configured" }, 503);
  const language = String(body?.language || "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{M} ()'-]{2,40}$/u.test(language)) return json({ error: "bad language name" }, 400);
  const part = body?.part === "ui" ? "ui" : String(body?.part || "");
  if (part !== "ui" && !/^[a-z0-9]{1,8}$/.test(part)) return json({ error: "bad part" }, 400);
  const strings = partStrings(en, part);
  if (!Object.keys(strings).length) return json({ error: "nothing to translate" }, 400);

  const key = `${language.toLowerCase()}|${part}|${await sha(JSON.stringify(strings))}`;
  const cacheUrl = new URL(`https://ride-translate.invalid/${encodeURIComponent(key)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheUrl);
  if (hit) return json({ language, part, strings: await hit.json(), aiTranslated: true, cached: true });
  if (!memo.has(key)) {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      callsInWindow = 0;
    }
    if (++callsInWindow > 60) return json({ error: "too many translation requests, try again soon" }, 429);
    memo.set(key, callClaude(env, language, strings));
  }
  try {
    const result = await memo.get(key);
    ctx.waitUntil(cache.put(cacheUrl, new Response(JSON.stringify(result), { headers: { "cache-control": "max-age=86400" } })));
    return json({ language, part, strings: result, aiTranslated: true });
  } catch (err) {
    memo.delete(key);
    return json({ error: "translation failed", detail: String(err?.message || err).slice(0, 200) }, 502);
  }
}

async function callClaude(env, language, strings) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });
  const schema = z.object(Object.fromEntries(Object.keys(strings).map((k) => [k, z.string()])));
  const response = await client.messages.parse({
    model: env.TRANSLATE_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    system:
      "You translate short texts for a live quiz game played on phones by people from Indian nonprofits. " +
      "Translate every value of the JSON object into the language named by the user, in that language's usual script. " +
      "Use plain, everyday words. Keep option labels short. Keep {placeholders} like {n} and {name} exactly as they are. " +
      "Keep the keys unchanged. If the language name is not a real language, return the English text unchanged.",
    messages: [{ role: "user", content: `<language>${language}</language>\n<strings>\n${JSON.stringify(strings, null, 1)}\n</strings>` }],
  });
  if (response.stop_reason === "refusal") throw new Error("model declined");
  if (!response.parsed_output) throw new Error("no structured output");
  return response.parsed_output;
}

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
