/* The Ride — moderator view (/moderator). Notes and controls for the moderator only; never on the projector.
 * Follows the game through a BroadcastChannel (another window on the presenter's laptop, works offline)
 * or through the server (a phone, with the Worker deployed).
 * For every step: what's on screen, the moderator note, what's coming next, live vote counts, the word-cloud
 * approval queue, a discussion timer, and any text still to fill in (amber). Controls reach the projector the
 * same way (BroadcastChannel, or relayed by the server); the projector does the work.
 */
import { flatten, isVote, isCloud, choicesOf, personaOf, stopTotal, filled, nextLabel, placeholdersOf } from "./route.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const PIN_KEY = "ride.pin";
const LETTERS = "ABCDEFGH";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("the-ride") : null;
const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(h);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let C;
let STEPS = [];
let pin = null;
let serverOk = false;
let local = null; // the projector on this laptop (BroadcastChannel)
let remote = null; // server state
let words = []; // live word-cloud entries for this step (all statuses)
let duration = 60;
let renderedKey = "";

const PHASE_LABEL = { lobby: "Lobby: riders joining", arrive: "Arriving at the stop", show: "On screen", showcase: "Websites on screen", ask: "Voting open", locked: "Votes locked", reveal: "Answer revealed" };
const TYPE_LABEL = { intro: "Intro", showcase: "Websites and question", question: "Question", reveal: "Reveal", persona: "New rider", infocard: "Info card", pump: "Refuel stop", closing: "Closing" };

async function adminCall(body) {
  const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pin }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// ---------------------------------------------------------------- PIN gate
function gate(error = "") {
  app.innerHTML = `<form class="gate" id="gate">
    <h1>Moderator view</h1>
    <p>Notes, live counts, the word-cloud queue and the timer. Keep this on your laptop or phone, never on the projector.</p>
    <label for="pin">Presenter PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" />
    <div class="err" role="alert">${esc(error)}</div>
    <button type="submit" class="btn">Open the moderator view</button></form>`;
  $("#pin").focus();
  $("#gate").addEventListener("submit", async (e) => {
    e.preventDefault();
    pin = $("#pin").value.trim();
    await unlock();
  });
}
async function unlock() {
  try {
    const r = await adminCall({ action: "check" });
    if (r.status === 401) {
      try { localStorage.removeItem(PIN_KEY); } catch {}
      return gate("That PIN didn't match. Try again.");
    }
    if (r.status !== 200) throw new Error(r.status);
    serverOk = true;
    try { localStorage.setItem(PIN_KEY, pin); } catch {}
    remote = r.data.state;
  } catch {
    serverOk = false; // offline Host Mode: only the projector window on this laptop can feed us
  }
  start();
}

// ---------------------------------------------------------------- following the game
function start() {
  duration = C.config?.timerSeconds || 60;
  channel?.postMessage({ type: "hello" });
  setInterval(tick, 300);
  if (serverOk) {
    setInterval(async () => {
      try {
        const r = await fetch("/api/state?role=presenter", { cache: "no-store" });
        if (r.ok) remote = { ...(await r.json()), at: Date.now() };
      } catch {}
    }, 1500);
    setInterval(loadWords, 2000);
  }
  tick(true);
}
async function loadWords() {
  const cur = current();
  if (!cur || !isCloud(STEPS[cur.i])) return (words = []);
  try {
    const r = await adminCall({ action: "words" });
    if (r.status === 200) {
      words = r.data.words.filter((w) => w.slot === STEPS[cur.i].id); // only this step's cloud
      renderQueue();
    }
  } catch {}
}
if (channel)
  channel.onmessage = (ev) => {
    if (ev.data?.type === "state") local = ev.data;
  };

const localFresh = () => !!local && Date.now() - local.at < 6000;
/** Where the game is: from the projector on this laptop, else from the server. */
function current() {
  if (localFresh()) return { src: "Following this laptop", ...local };
  if (remote) {
    const i = Math.max(0, STEPS.findIndex((s) => s.id === remote.slot));
    const s = STEPS[i];
    const phase = { idle: "lobby", arrive: "arrive", open: "ask", closed: "locked", reveal: "reveal" }[remote.phase] || (s.type === "showcase" ? "showcase" : "show");
    const t = remote.timer || {};
    const low = isVote(s) && remote.riders > 0 && phase === "locked" && (remote.n || 0) / remote.riders < (C.config.lowTurnout ?? 0.3);
    return { src: "Following the server", remote: true, i, phase, n: remote.n || 0, counts: remote.tally?.counts || {}, riders: remote.riders, vote: remote.vote, low, at: remote.at || Date.now(), mode: "live", timer: { endsAt: t.running ? Date.now() + t.remainingMs : null, duration: t.duration, fromServer: true } };
  }
  if (local) return { src: "Projector quiet: last known state", ...local };
  return null;
}
let serverEnds = null;
function timerEnds(cur) {
  if (!cur?.timer) return null;
  if (!cur.timer.fromServer) return cur.timer.endsAt;
  const e = cur.timer.endsAt;
  if (!e) return (serverEnds = null);
  if (!serverEnds || Math.abs(serverEnds - e) > 1500) serverEnds = e;
  return serverEnds;
}

// ---------------------------------------------------------------- notes per step
/** The main text of a step, as the audience sees it. */
function onScreen(s) {
  switch (s.type) {
    case "intro": return `${s.title}. ${s.line} ${s.mission}`;
    case "showcase": return s.line;
    case "question": case "pump": return s.question;
    case "reveal": return s.takeaway ? `${s.text} ${s.takeaway}` : s.text;
    case "persona": return `${C.personas[s.persona]?.name}: “${s.line}”`;
    case "infocard": return `${s.title}. ${s.text}`;
    case "closing": return `${s.text} ${s.finalLine}`;
  }
  return "";
}
/** A short heading for the step. */
function headline(s) {
  if (s.type === "persona") return `${C.personas[s.persona]?.name}, ${C.personas[s.persona]?.role.toLowerCase()}`;
  if (s.type === "closing") return s.finalLine;
  if (s.type === "reveal") return s.takeaway || s.text;
  return s.question || s.title || s.line || "";
}
/** What comes after this screen, so the moderator can tease it. */
function comingNext(cur) {
  const s = STEPS[cur.i];
  if (cur.phase === "lobby") return `Intro: ${C.intro.title}.`;
  if (cur.phase === "arrive") return `${TYPE_LABEL[s.type]}: ${onScreen(s)}`;
  if (s.type === "showcase" && cur.phase !== "reveal") return `The reveal: ${s.reveal}`;
  const nx = STEPS[cur.i + 1];
  if (!nx) return "Nothing. This is the end of the ride.";
  if (nx.stopIndex !== s.stopIndex) {
    const stop = C.stops[nx.stopIndex];
    const p = stop.persona ? C.personas[stop.persona] : null;
    return `Ride to ${stop.place} (${stop.km.toLocaleString("en-IN")} km). ${p ? `${p.name}, ${p.role.toLowerCase()}${stop.voice ? `: “${stop.voice}”` : "."}` : stop.theme + "."}`;
  }
  return `${TYPE_LABEL[nx.type]}: ${onScreen(nx)}`;
}

// ---------------------------------------------------------------- controls (the projector shows none)
let flashMsg = { text: "", at: 0 };
/** Send a command to the projector: BroadcastChannel when it runs on this laptop, else relayed by the server. */
async function send(cmd, extra = {}) {
  if (localFresh()) {
    channel.postMessage({ type: "cmd", cmd, ...extra });
    return true;
  }
  if (serverOk) {
    try {
      const r = await adminCall({ action: "command", cmd, ...extra });
      if (r.status === 200 && r.data?.sent) return true;
      if (r.status === 200) return flash("The projector isn't connected to the live server right now."), false;
    } catch {}
  }
  flash("Couldn't reach the projector. Check that it's open.");
  return false;
}
function flash(text) {
  flashMsg = { text, at: Date.now() };
  tick(true);
}
/** The room-result keys for this step (Host Mode, or overriding Live votes): [key, label, title]. */
function entryKeysFor(s, cur) {
  if (cur.phase !== "ask" || !isVote(s) || isCloud(s)) return null;
  if (s.format === "pickn") return { keys: s.items.map((o, k) => [String(k + 1), String(k + 1), o.text]), clear: true };
  return { keys: choicesOf(s).map((o, k) => [LETTERS[k], LETTERS[k], o.text]), clear: true };
}
const mmss = (ms) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
let controlsKey = "";
function renderControls(cur) {
  const box = $("#controls");
  if (!cur) return box.classList.add("hidden");
  box.classList.remove("hidden");
  const s = STEPS[cur.i] || STEPS[0];
  const ph = cur.phase;
  const v = cur.vote || {};
  const votingRow = isVote(s) && (ph === "ask" || ph === "locked");
  const cloud = isCloud(s) && (ph === "ask" || ph === "locked");
  const keys = entryKeysFor(s, cur);
  const label = nextLabel(C, STEPS, cur.i, ph);
  const end = cur.i === STEPS.length - 1 && ph === "show";
  const key = JSON.stringify([cur.i, ph, cur.mode, cur.lost, cur.canReturn, cur.muted, !!v.paused, !!v.locked, votingRow, cloud, !!keys, localFresh(), !!cur.busy]);
  if (key !== controlsKey) {
    controlsKey = key;
    const dual = s.format === "dualcloud";
    box.innerHTML = `
      <div class="status" id="cStatus"></div>
      ${cur.canReturn ? `<div class="row"><button type="button" class="btn amber" data-c="returnLive">Return to Live</button></div>` : ""}
      <div class="row main">
        <button type="button" class="btn sec back" data-c="back" ${ph === "lobby" || cur.busy ? "disabled" : ""}>Back</button>
        <button type="button" class="btn go" data-c="next" ${cur.busy || end ? "disabled" : ""}>${esc(label)}</button>
      </div>
      ${votingRow ? `<div class="row">
        <button type="button" class="btn sec" data-c="pause" ${ph !== "ask" || v.locked ? "disabled" : ""}>${v.paused ? "Resume countdown" : "Pause countdown"}</button>
        <button type="button" class="btn sec" data-c="extend" data-arg="15" ${ph !== "ask" ? "disabled" : ""}>Add 15 seconds</button>
        <button type="button" class="btn sec" data-c="closeVote">${ph === "ask" && !v.locked ? "Lock votes now" : "Reopen voting"}</button></div>` : ""}
      ${keys ? `<div class="row keys" role="group" aria-label="The room's answer (Host mode)">${keys.keys.map(([k, lab, title]) => `<button type="button" class="btn sec" data-key="${esc(k)}" title="${esc(title)}" aria-label="${esc(`${lab}: ${title}`)}">${esc(lab)}</button>`).join("")}${keys.clear ? `<button type="button" class="btn sec" data-key="0">Clear</button>` : ""}</div>` : ""}
      ${cloud ? `<form class="wordrow" id="wordForm"><input id="wordIn" maxlength="40" autocomplete="off" placeholder="Add an answer from the room" aria-label="Answer to add to the word cloud"/>${dual ? s.parts.map((pt, k) => `<button class="btn ${k ? "sec" : ""}" type="submit" data-part="${k}">Add to “${esc(pt.title)}”</button>`).join("") : `<button class="btn" type="submit" data-part="0">Add it</button>`}</form>` : ""}
      <div class="hints" id="cHints" aria-live="polite"></div>
      <details class="more"><summary>Sound, Host or Live, reset</summary><div class="row">
        <button type="button" class="btn sec" data-c="mute">${cur.muted ? "Turn sound on" : "Turn sound off"}</button>
        ${cur.remote ? "" : `<button type="button" class="btn sec" data-c="mode">${cur.mode === "live" ? "Switch to Host mode" : "Go live"}</button>`}
        <button type="button" class="btn warn" data-c="reset">Reset the ride</button></div></details>`;
    box.querySelectorAll("[data-c]").forEach((b) =>
      b.addEventListener("click", async () => {
        const c = b.dataset.c;
        if (c === "reset" && !confirm(cur.mode === "live" ? "Reset the ride? This clears every answer and word on the server and returns to the lobby." : "Reset the ride? This clears the room's answers and returns to the lobby.")) return;
        b.disabled = true;
        await send(c, b.dataset.arg ? { arg: Number(b.dataset.arg) } : {});
        setTimeout(() => (b.disabled = false), 400);
      })
    );
    box.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", () => send("key", { key: b.dataset.key })));
    box.querySelector("#wordForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inp = $("#wordIn");
      const text = inp.value.replace(/\s+/g, " ").trim();
      if (!text) return inp.focus();
      const part = Number(e.submitter?.dataset.part || 0);
      if (await send("addWord", { text, arg: part })) {
        inp.value = "";
        flash(`Added “${text}”${dual ? ` to “${s.parts[part].title}”` : ""}.`);
      }
      inp.focus();
    });
  }
  // Live numbers: mode, riders, answers, countdown, and messages
  const left = v.running ? v.remainingMs - (Date.now() - (cur.at || Date.now())) : v.remainingMs;
  const cdTxt = ph !== "ask" || !cur.vote ? (ph === "locked" ? `<span class="cd lockedc">Votes locked</span>` : "") : v.locked ? `<span class="cd lockedc">Votes locked</span>` : `<span class="cd">${v.paused ? "Paused · " : ""}${mmss(left)}</span>`;
  const badge = cur.mode === "live" ? `<span class="badge live">Live</span>` : cur.lost ? `<span class="badge lost">Host mode · Live lost</span>` : `<span class="badge">Host mode</span>`;
  $("#cStatus").innerHTML = `${badge}${cur.mode === "live" ? `<span><b>${cur.riders ?? 0}</b> riders</span>${isVote(s) && ph !== "showcase" ? `<span><b>${cur.n ?? 0}</b> answers</span>` : ""}` : ""}${cur.fuel != null ? `<span>Fuel <b>${cur.fuel}%</b></span>` : ""}${cdTxt}`;
  const toast = cur.toast && Date.now() - cur.toast.at < 8000 ? cur.toast.text : "";
  const mine = Date.now() - flashMsg.at < 6000 ? flashMsg.text : "";
  $("#cHints").innerHTML = [
    cur.help ? `<p>${esc(cur.help)}</p>` : "",
    toast ? `<p class="toast">Projector: ${esc(toast)}</p>` : "",
    mine ? `<p class="toast">${esc(mine)}</p>` : "",
  ].join("");
}

function tick(force) {
  const cur = current();
  renderControls(cur);
  $("#src").textContent = cur ? cur.src : serverOk ? "Waiting for the server…" : "Waiting for the projector";
  $("#src").classList.toggle("ok", !!cur);
  if (!cur) {
    if (renderedKey !== "none") {
      renderedKey = "none";
      app.innerHTML = `<section class="card"><h2>Waiting for the projector</h2><p>${serverOk ? "Connecting to the live game. This takes a few seconds." : "No live server found. Open the projector in another window or tab of this browser, and this page follows it."}</p></section>`;
    }
    return;
  }
  const ends = timerEnds(cur);
  const running = ends && ends > Date.now();
  const key = JSON.stringify([cur.i, cur.phase, cur.n, cur.counts, cur.low, cur.privateHost, !!running, cur.src, duration, (cur.words || []).length, cur.manual]);
  if (key !== renderedKey || force) {
    renderedKey = key;
    app.innerHTML = view(cur);
    wire();
    renderQueue();
  }
  const left = running ? Math.max(0, ends - Date.now()) : (cur.timer?.duration || duration) * 1000;
  const el = $("#tnum");
  if (el) el.textContent = mmss(left);
}

function view(cur) {
  const s = STEPS[cur.i] || STEPS[0];
  const stop = C.stops[s.stopIndex];
  const where =
    cur.phase === "lobby" ? "Before the ride" :
    s.stopIndex < 0 ? "Before we ride" :
    `${stop.arrival ? "Arrival" : `Stop ${s.stopIndex + 1} of ${stopTotal(C)}`} · ${stop.place} · step ${s.stepIndex + 1} of ${s.stepCount}${s.qn ? ` · Question ${s.qn} of ${s.qTotal}` : ""}`;
  const amber = [];
  if (cur.low) amber.push(`<section class="card amber" role="alert"><h2>Low turnout</h2><p class="answer">Low turnout. Ask the room to join.</p></section>`);
  if (cur.privateHost ?? isPrivateHost(location.hostname)) amber.push(`<section class="card amber"><h2>Phones can't reach this address</h2><p>The QR code points at a local address. Open the projector from the public URL so phones can join.</p></section>`);
  const ph = cur.phase === "lobby" || cur.phase === "arrive" ? [] : placeholdersOf(s); // only for the step on screen
  if (ph.length) amber.push(`<section class="card amber"><h2>Still to fill in (hidden from the audience)</h2><ul>${ph.map((p) => `<li><b>${esc(p.what)}:</b> ${esc(p.text)}</li>`).join("")}</ul><p class="note">Edit public/content/en.json, then reload the projector.</p></section>`);

  if (cur.phase === "lobby")
    return `<p class="where">${esc(where)}</p><h1>${esc(C.lobby.title)}</h1><p><span class="phase">${esc(PHASE_LABEL.lobby)}</span>${cur.mode === "live" ? ` <span class="stat">· ${cur.riders || 0} riders on board</span>` : ""}</p>${amber.join("")}
      <section class="card key"><h2>Moderator note</h2><p class="answer">Give people a minute to scan the code. Start the ride when most of the room has joined.</p></section>
      <section class="card"><h2>Coming next</h2><p>${esc(comingNext(cur))}</p></section>${timerCard(cur)}`;

  if (cur.phase === "arrive") {
    const p = stop.persona ? C.personas[stop.persona] : null;
    return `<p class="where">${esc(where)}</p><h1>${esc(stop.milestone)} · ${esc(stop.km.toLocaleString("en-IN"))} km</h1><p><span class="phase">${esc(PHASE_LABEL.arrive)}</span></p>${amber.join("")}
      <section class="card"><h2>On screen</h2><p class="answer">${esc(stop.theme)}</p>${p ? `<p>${esc(`${p.name}, ${p.role.toLowerCase()}`)}</p>${stop.voice ? `<p><i>“${esc(stop.voice)}”</i></p>` : ""}` : ""}</section>
      <section class="card"><h2>Steps at this stop</h2><ol>${stop.steps.map((x) => `<li>${esc(TYPE_LABEL[x.type])}: ${esc(onScreen(x))}</li>`).join("")}</ol></section>${timerCard(cur)}`;
  }

  const persona = personaOf(C, s);
  const vote = isVote(s) && cur.phase !== "showcase";
  return `<p class="where">${esc(where)}</p>
    <h1>${esc(headline(s))}</h1>
    <p><span class="phase">${esc(PHASE_LABEL[cur.phase] || "On screen")}</span>${vote && cur.mode === "live" ? ` <span class="stat">· ${cur.n || 0} of ${cur.riders || 0} riders answered</span>` : ""}</p>
    ${amber.join("")}
    <section class="card"><h2>On screen</h2>${persona ? `<p class="note">${esc(`${persona.name}, ${persona.role.toLowerCase()}`)}</p>` : ""}<p>${esc(onScreen(s))}</p>
      ${s.rows ? `<ul>${s.rows.map((r) => `<li>${esc(r.from)} → ${esc(r.to)}</li>`).join("")}</ul>` : ""}
      ${s.link && filled(s.link.url) ? `<p><a class="btn sec" href="${esc(s.link.url)}" target="_blank" rel="noopener">Open ${esc(s.link.label)}</a></p>` : ""}
      ${s.sites ? `<div class="row">${s.sites.map((x) => `<a class="btn sec" href="${esc(x.url)}" target="_blank" rel="noopener">Open ${esc(x.title)} live</a>`).join("")}</div>` : ""}</section>
    ${s.note ? `<section class="card key"><h2>Moderator note</h2><p class="answer">${esc(s.note)}</p></section>` : ""}
    ${vote && !isCloud(s) ? countsCard(s, cur) : ""}
    ${isCloud(s) && (cur.phase === "ask" || cur.phase === "locked") ? `<section class="card" aria-labelledby="qh"><h2 id="qh">Word-cloud queue</h2><div id="queue" aria-live="polite"></div></section>` : ""}
    <section class="card"><h2>Coming next</h2><p>${esc(comingNext(cur))}</p></section>
    ${timerCard(cur)}`;
}

/** Live vote counts for the step on screen (or the room's pick typed in Host mode). */
function countsCard(s, cur) {
  const counts = cur.counts || {};
  const n = cur.n || 0;
  const manual = cur.manual || {};
  const rows = choicesOf(s).map((o, k) => {
    const c = counts[o.id] || 0;
    const p = n ? Math.round((c / n) * 100) : 0;
    const picked = manual.choice === o.id || manual.picks?.includes(o.id);
    return `<li><span class="k">${s.format === "pickn" ? k + 1 : LETTERS[k]}</span><span class="t">${esc(o.text)}${picked ? ` <b class="pick">Room's pick</b>` : ""}</span><span class="bar" aria-hidden="true"><i style="width:${p}%"></i></span><span class="c">${c} · ${p}%</span></li>`;
  });
  return `<section class="card"><h2>${cur.mode === "live" ? `Live votes (${n})` : "The room's answer (Host mode)"}</h2><ul class="counts">${rows.join("")}</ul>${cur.mode === "live" ? "" : `<p class="note">Host mode counts the room as fully on board for fuel.</p>`}</section>`;
}

function timerCard(cur) {
  const running = (timerEnds(cur) || 0) > Date.now();
  return `<section class="card timer"><h2>Discussion timer</h2><div class="tnum" id="tnum" role="timer" aria-live="off">${mmss(duration * 1000)}</div>
    <div class="trow">${running ? `<button type="button" class="btn" data-t="stop">Stop the timer</button>` : `<button type="button" class="btn sec" data-t="minus" aria-label="15 seconds less">−15 s</button><button type="button" class="btn" data-t="start">Start ${duration} s</button><button type="button" class="btn sec" data-t="plus" aria-label="15 seconds more">+15 s</button>`}</div>
    <p class="note">Only you see this timer. The voting countdown is in the controls above.</p></section>`;
}

const partTag = (w, s) => {
  const pt = w.part && s?.parts?.find((x) => x.id === w.part);
  return pt ? `<span class="ptag ${esc(pt.color)}">${esc(pt.title)}</span>` : "";
};
function renderQueue() {
  const box = $("#queue");
  if (!box) return;
  const cur = current();
  const s = STEPS[cur?.i];
  if (!serverOk || cur?.mode !== "live") {
    const w = (cur?.words || []).map((x) => `<li>${partTag(x, s)}<span class="w">${esc(x.text)}</span>${x.n > 1 ? `<span class="c">×${x.n}</span>` : ""}</li>`).join("");
    box.innerHTML = `<p class="note">Host mode: add answers from the room above (or press ${s?.format === "dualcloud" ? "W and N" : "W"} on the projector). They need no approval.</p>${w ? `<ul class="queue">${w}</ul>` : `<p class="note">No answers yet.</p>`}`;
    return;
  }
  const pending = words.filter((w) => w.status === "pending");
  const approved = words.filter((w) => w.status === "approved");
  box.innerHTML = `
    <h3>Waiting for you (${pending.length})</h3>
    ${pending.length ? `<ul class="queue">${pending.map((w) => `<li>${partTag(w, s)}<span class="w">${esc(w.text)}</span><span class="qbtns"><button type="button" class="btn ok" data-w="${w.id}" data-s="approved" aria-label="Approve ${esc(w.text)}">Approve</button><button type="button" class="btn no" data-w="${w.id}" data-s="rejected" aria-label="Reject ${esc(w.text)}">Reject</button></span></li>`).join("")}</ul>` : `<p class="note">Nothing waiting. New answers from phones appear here.</p>`}
    <h3>On the projector (${approved.length})</h3>
    ${approved.length ? `<ul class="queue done">${approved.map((w) => `<li>${partTag(w, s)}<span class="w">${esc(w.text)}</span><button type="button" class="btn sec" data-w="${w.id}" data-s="rejected" aria-label="Remove ${esc(w.text)}">Remove</button></li>`).join("")}</ul>` : `<p class="note">None yet. Approve an answer to put it on the big screen.</p>`}`;
  box.querySelectorAll("[data-w]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      await adminCall({ action: "word", id: Number(b.dataset.w), status: b.dataset.s });
      await loadWords();
    })
  );
}

function wire() {
  app.querySelectorAll("[data-t]").forEach((b) =>
    b.addEventListener("click", async () => {
      const t = b.dataset.t;
      if (t === "minus") duration = Math.max(15, duration - 15);
      if (t === "plus") duration = Math.min(600, duration + 15);
      if (t === "start" || t === "stop") {
        let viaServer = false;
        if (serverOk) {
          try {
            const r = await adminCall({ action: "timer", cmd: t, duration });
            if (r.status === 200) {
              remote = r.data.state;
              viaServer = true;
            }
          } catch {}
        }
        channel?.postMessage({ type: "timer", cmd: t, duration, viaServer });
        if (local) local = { ...local, timer: t === "start" ? { endsAt: Date.now() + duration * 1000, duration } : { endsAt: null, duration }, at: Date.now() };
      }
      tick(true);
    })
  );
}

(async function init() {
  try {
    C = await (await fetch("/content/en.json", { cache: "no-store" })).json();
  } catch {
    app.innerHTML = `<section class="card"><h2>The moderator view can't load</h2><p>The game content didn't arrive. Check the connection to the server, then reload this page.</p></section>`;
    return;
  }
  STEPS = flatten(C);
  try { pin = localStorage.getItem(PIN_KEY); } catch {}
  let hostOnly = false;
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    hostOnly = !r.ok || !!(await r.json()).hostOnly;
  } catch {
    hostOnly = true;
  }
  if (hostOnly) {
    serverOk = false; // no Live server (offline Host Mode): follow the projector on this laptop
    return start();
  }
  if (pin) return unlock();
  gate();
})();

