/* The Ride — moderator view (/moderator). Notes for the moderator only; never on the projector.
 * Follows the game through a BroadcastChannel (another window on the presenter's laptop,
 * works offline) or through the server (a phone, with Live Vote deployed).
 * Shows the answer, reveal, talking points, pitstop rules, a timer, and the word-cloud
 * approval queue.
 */
import { gapsFor, expandRoute } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const PIN_KEY = "ride.pin";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("the-ride") : null;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (p) => String(p || "").split(",")[0];
const isCloud = (it) => it?.type === "wordcloud" || it?.type === "dualcloud";
/** Which cloud an entry belongs to (dualcloud): a coloured BUILD / NEVER tag. */
function partTag(w) {
  const it = ROUTE[current()?.i];
  const pt = w.part && it?.parts?.find((x) => x.id === w.part);
  return pt ? `<span class="ptag ${esc(pt.color)}">${esc(pt.title)}</span>` : "";
}

let en;
let ROUTE = []; // every step, with its stop's place / persona (content/en.json → stops + route)
let pin = null;
let serverOk = false;
let local = null; // presenter on this laptop (BroadcastChannel)
let remote = null; // server state
let words = []; // live word-cloud entries (all statuses)
let duration = 60;
let renderedKey = "";

const PHASES = { lobby: "Lobby (riders joining)", card: "On screen", intro: "Intro", idle: "Lobby", arrive: "Arriving", hurdle: "Hurdle signs (voting not open yet)", ask: "Question open", open: "Voting open", closed: "Voting closed", reveal: "Revealed", info: "Pitstop", summary: "Finale", end: "Finale" };

async function adminCall(body) {
  const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pin }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// ---------------------------------------------------------------- PIN gate
function gate(error = "") {
  app.innerHTML = `<form class="gate" id="gate">
    <h1>Moderator notes</h1>
    <p>Answers, talking points, the word-cloud queue and the timer. Keep this on your laptop or phone, never on the projector.</p>
    <label for="pin">Presenter PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" />
    <div class="err" role="alert">${esc(error)}</div>
    <button>Open</button></form>`;
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
      return gate("Wrong PIN.");
    }
    if (r.status !== 200) throw new Error(r.status);
    serverOk = true;
    try { localStorage.setItem(PIN_KEY, pin); } catch {}
    remote = r.data.state;
  } catch {
    serverOk = false; // offline Host Mode: only the presenter window on this laptop can feed us
  }
  start();
}

// ---------------------------------------------------------------- following the game
function start() {
  duration = en.config?.timerSeconds || 60;
  channel?.postMessage({ type: "hello" });
  setInterval(tick, 300);
  if (serverOk) {
    setInterval(async () => {
      try {
        const r = await fetch("/api/state?role=presenter", { cache: "no-store" });
        if (r.ok) remote = await r.json();
      } catch {}
    }, 1500);
    setInterval(loadWords, 2000);
  }
  tick(true);
}
async function loadWords() {
  const cur = current();
  if (!cur || !isCloud(ROUTE[cur.i])) return;
  try {
    const r = await adminCall({ action: "words" });
    if (r.status === 200) {
      words = r.data.words.filter((w) => w.slot == null || w.slot === ROUTE[cur.i]?.id); // only this question's cloud (entries carry the step id)
      renderQueue();
    }
  } catch {}
}
if (channel)
  channel.onmessage = (ev) => {
    if (ev.data?.type === "state") local = ev.data;
  };

function current() {
  if (local && Date.now() - local.at < 6000) return { src: "Following the presenter on this laptop", ...local };
  if (remote) {
    const [a, b] = String(remote.slot).split(".");
    const i = ROUTE.findIndex((r) => r.id === a); // slots are named by step id
    const t = remote.timer || {};
    return { src: "Following the live server", i, sub: b === "m" ? 0 : Number(b || 0), mirror: b === "m", phase: remote.phase, n: remote.n, mode: "live", timer: { endsAt: t.running ? Date.now() + t.remainingMs : null, duration: t.duration, fromServer: true } };
  }
  if (local) return { src: "Presenter window quiet (last known state)", ...local };
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

// ---------------------------------------------------------------- notes per item
function answerFor(it, sub, mirror) {
  const txt = (list, id) => list.find((o) => o.id === id)?.text ?? id;
  if (it.kind === "card") return "Info card. No vote: talk it through, then → to ride on.";
  if (mirror) return `Mirror poll, no right answer and no fuel. Options: ${it.mirror.options.map((o) => o.text).join(" / ")}.${it.mirror.compareWith ? ` The reveal compares today (the ${it.mirror.compareWith.toUpperCase()} mirror) with 6 months from now.` : ""}`;
  if (it.kind === "question")
    switch (it.type) {
      case "estimate": return `Then: ${it.answerText.then}. Now: ${it.answerText.now}. ${it.placeholder || ""}`;
      case "tapstep": return `Step ${it.steps.findIndex((s) => s.id === it.answer) + 1}: ${txt(it.steps, it.answer)}`;
      case "choose": return it.answer ? `${it.answer}: ${txt(it.options, it.answer)}${it.almost?.length ? `. Second best (ALMOST, still counts as wrong): ${it.almost.map((a) => `${a}: ${txt(it.options, a)}`).join(", ")}` : ""}` : "No right answer. Not scored.";
      case "checkpoint": { const g = gapsFor(it).find((x) => x.id === it.answer); return `Between “${g.after.text}” and “${g.before.text}”`; }
      case "pickn": return `Any ${it.n} except the decoys: ${it.decoys.map((d) => txt(it.items, d)).join(", ")}`;
      case "rank": return `Lowest risk: ${txt(it.items, it.firstItem)}. Highest risk: ${txt(it.items, it.lastItem)}.`;
      case "match": return it.items.map((x) => `${it.keyMatch.includes(x.id) ? "★ " : ""}${x.text} → ${txt(it.buckets, it.answers[x.id])}`).join("\n");
      case "wordcloud": return "No right answer. Approve answers below so they appear on the projector.";
      case "dualcloud": return `No right answer. Two clouds: ${it.parts.map((p) => `${p.title.toUpperCase()} = “${p.text}”`).join(" ")} Approve answers below; each one is tagged with its cloud.`;
    }
  switch (it.pitType) {
    case "petrol": return `Fuel +${it.fuel.shareYes}% × the share who say Yes.`;
    case "landslide": return `${txt(it.poll.options, it.answer)}. Fuel ${it.fuel.right}% if the room gets it, ${it.fuel.wrong}% if not.`;
    case "checkpost": return it.rounds.map((r, k) => `${k === sub ? "▶ " : ""}Round ${k + 1}: ${r.text} → ${txt(it.options, r.answer)}`).join("\n") + `\n+${it.fuel.perRight}% fuel per right round.`;
    case "viewpoint": { const sc = it.showcases[sub] || it.showcases[0]; return (it.revealAfter ? `Answers stay hidden here and are revealed after ${it.revealAfter.toUpperCase()}. ` : "") + `${sc.title}: ` + it.polls.map((q) => `${q.question} ${txt(q.options, sc.answers[q.id])}`).join(" · ") + (sc.note ? `\n${sc.note}` : ""); }
    case "mechanic": return `Tip card, no vote. Fuel +${it.fuel.add}%.`;
    case "chai": return `${it.seconds}-second timer on the projector. No vote.`;
  }
  return "";
}

function tick(force) {
  const cur = current();
  $("#src").textContent = cur ? cur.src : serverOk ? "Waiting for the server…" : "Open the game in another window of this browser";
  $("#src").classList.toggle("ok", !!cur);
  if (!cur) {
    if (renderedKey !== "none") {
      renderedKey = "none";
      app.innerHTML = `<section class="card"><h2>Waiting</h2><p>${serverOk ? "Connecting to the live game…" : "No live server found. Open the presenter screen in another window or tab of this browser and this page will follow it."}</p></section>`;
    }
    return;
  }
  const ends = timerEnds(cur);
  const running = ends && ends > Date.now();
  const key = JSON.stringify([cur.i, cur.sub, cur.mirror, cur.phase, cur.n, cur.result, !!running, cur.src, duration, (cur.words || []).length]);
  if (key !== renderedKey || force) {
    renderedKey = key;
    app.innerHTML = view(cur);
    wire();
    renderQueue();
  }
  const left = running ? Math.max(0, ends - Date.now()) : (cur.timer?.duration || duration) * 1000;
  const sec = Math.ceil(left / 1000);
  const el = $("#tnum");
  if (el) el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function view(cur) {
  const it = ROUTE[cur.i] || ROUTE[0];
  const phase = PHASES[cur.phase] || cur.phase;
  const qn = ROUTE.slice(0, cur.i + 1).filter((r) => r.kind === "question").length;
  const where = it.stopIndex != null ? `Stop ${it.stopIndex + 1}/${en.stops.length} · step ${it.stepIndex + 1}/${it.stepCount} · ` : "";
  if (cur.phase === "arrive") {
    // Arriving at a stop: the milestone, km and persona (introduced once per stop)
    const steps = en.stops[it.stopIndex]?.steps || [];
    return `<p class="where">${esc(`Stop ${it.stopIndex + 1}/${en.stops.length} · arriving`)}</p>
      <h1>${esc(it.milestone || it.stopPlace)} · ${esc(it.km.toLocaleString("en-IN"))} km</h1>
      <section class="card key"><h2>Persona</h2><p class="answer">${esc([it.personaName, it.role, it.orgType].filter(Boolean).join(" · "))}</p>${it.voice ? `<p><i>“${esc(it.voice)}”</i></p>` : ""}</section>
      <section class="card"><h2>Steps at this stop</h2><ol>${steps.map((id) => { const s = ROUTE.find((r) => r.id === id); return `<li>${esc(s.kind === "question" ? s.question : s.kind === "intro" ? "Intro card" : s.title || s.board || s.place)}</li>`; }).join("")}</ol></section>${timerCard(cur)}`;
  }
  if (it.kind === "intro")
    return `<p class="where">${esc(where)}Intro card</p><h1>${esc(en.title)}</h1><p><span class="phase">${esc(PHASES[cur.phase] || cur.phase)}</span></p>
      <section class="card"><h2>On screen</h2><p>${esc(en.subtitle)}</p><p>${esc(en.intro)}</p></section>
      <section class="card key"><h2>Notes</h2><p class="answer">Welcome the room. → goes to the viewpoint.</p></section>${timerCard(cur)}`;
  const head = where + (it.kind === "question" ? `Question ${qn} · ${it.milestone || short(it.place)} · ${cur.mirror ? "mirror poll" : it.type}` : it.kind === "card" ? `Info card · near ${short(nearest(cur.i))}` : `Pitstop · ${it.title || it.place} · near ${short(nearest(cur.i))}`);
  const ended = cur.phase === "summary" || cur.phase === "end";
  if (cur.phase === "lobby" || cur.phase === "intro" || cur.phase === "idle")
    return `<p class="where">Start · Bengaluru</p><h1>${esc(en.title)}</h1><section class="card"><h2>Next</h2><p>Press → on the projector to arrive at Bengaluru.</p></section>${timerCard(cur)}`;
  return `<p class="where">${esc(head)}</p>
    <h1>${esc(it.kind === "question" ? [it.personaName, it.shift].filter(Boolean).join(": ") : it.kind === "card" ? it.title : it.board)}</h1>
    ${it.kind === "question" ? `<p class="who">${esc([it.role, it.orgType].filter(Boolean).join(" · "))}${it.voice ? `${it.role || it.orgType ? " · " : ""}<i>“${esc(it.voice)}”</i>` : ""}</p>` : ""}
    <p><span class="phase">${esc(ended ? "Finale" : phase)}</span>${cur.mode === "live" ? ` <span class="stat">· ${cur.n || 0} answers</span>` : ""}</p>
    ${it.kind === "question" ? `<section class="card"><h2>${cur.mirror ? "Mirror poll" : "Question"}</h2>${it.hurdles && !cur.mirror ? `<ol>${it.hurdles.map((h) => `<li>${esc(h)}</li>`).join("")}</ol>` : ""}${it.scenario && !cur.mirror ? `<p>${esc(it.scenario)}</p>` : ""}<p><b>${esc(cur.mirror ? it.mirror.question : it.question)}</b></p></section>` : ""}
    ${it.kind === "pitstop" && (it.poll || it.question) ? `<section class="card"><h2>Question</h2><p><b>${esc(it.poll?.question || it.question)}</b></p><p>${esc((it.poll?.options || it.options).map((o, k) => `${"ABCD"[k]}: ${o.text}`).join(" · "))}</p></section>` : ""}
    ${it.kind === "card" ? `<section class="card"><h2>On screen</h2>${it.rows ? `<ul>${it.rows.map((r) => `<li>${esc(r.from)} → ${esc(r.to)}</li>`).join("")}</ul>` : ""}<p>${esc(it.text)}</p>${it.link ? `<p class="note">Link: ${esc(it.link.url || it.link.label)}</p>` : ""}</section>` : ""}
    <section class="card key"><h2>${it.kind === "question" ? (cur.mirror ? "Notes" : "Answer") : it.kind === "card" ? "Notes" : "Rules and answers"}</h2><p class="answer">${esc(answerFor(it, cur.sub || 0, cur.mirror)).replace(/\n/g, "<br/>")}</p>
      ${cur.result ? `<p class="note">Right now: ${esc(cur.result)}.</p>` : ""}</section>
    ${it.reveal && !cur.mirror ? `<section class="card"><h2>Reveal</h2><p>${esc(it.reveal)}</p></section>` : ""}
    ${it.tips ? `<section class="card"><h2>Tip card</h2><ol>${it.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ol></section>` : ""}
    ${it.prompt ? `<section class="card"><h2>Prompt</h2><p>${esc(it.prompt)}</p></section>` : ""}
    ${it.moderatorTalkingPoints && !cur.mirror ? `<section class="card"><h2>Talking points</h2><ul>${it.moderatorTalkingPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></section>` : ""}
    ${isCloud(it) && !cur.mirror ? `<section class="card" aria-labelledby="qh"><h2 id="qh">Word cloud queue</h2><div id="queue" aria-live="polite"></div></section>` : ""}
    ${timerCard(cur)}`;
}
const nearest = (i) => {
  return ROUTE[i]?.stopPlace || ROUTE[0].place;
};

function timerCard(cur) {
  const running = (timerEnds(cur) || 0) > Date.now();
  return `<section class="card timer"><h2>Discussion timer</h2><div class="tnum" id="tnum" role="timer" aria-live="off"></div>
    <div class="trow">${running ? `<button class="btn" data-t="stop">Stop</button>` : `<button class="btn sec" data-t="minus" aria-label="15 seconds less">−15 s</button><button class="btn" data-t="start">Start ${duration} s</button><button class="btn sec" data-t="plus" aria-label="15 seconds more">+15 s</button>`}</div>
    <p class="note">The timer shows on the projector at pitstops. On questions only you see it.</p></section>`;
}

function renderQueue() {
  const box = $("#queue");
  if (!box) return;
  if (!serverOk) {
    const w = (current()?.words || []).map((x) => `<li>${partTag(x)}${esc(x.text)}${x.n > 1 ? ` ×${x.n}` : ""}</li>`).join("");
    const dual = ROUTE[current()?.i]?.type === "dualcloud";
    box.innerHTML = `<p class="note">Host Mode: the presenter adds answers with ${dual ? "W (first cloud) and N (second cloud)" : "W"}. They need no approval.</p><ul>${w}</ul>`;
    return;
  }
  const pending = words.filter((w) => w.status === "pending");
  const approved = words.filter((w) => w.status === "approved");
  box.innerHTML = `
    <h3>Waiting (${pending.length})</h3>
    ${pending.length ? `<ul class="queue">${pending.map((w) => `<li>${partTag(w)}<span class="w" ${w.lang && !w.lang.startsWith("other") ? `lang="${esc(w.lang)}"` : ""}>${esc(w.text)}</span><span class="qbtns"><button class="btn ok" data-w="${w.id}" data-s="approved" aria-label="Approve ${esc(w.text)}${w.part ? ` (${esc(w.part)})` : ""}">Approve</button><button class="btn no" data-w="${w.id}" data-s="rejected" aria-label="Reject ${esc(w.text)}">Reject</button></span></li>`).join("")}</ul>` : `<p class="note">Nothing waiting.</p>`}
    <h3>On the projector (${approved.length})</h3>
    <ul class="queue done">${approved.map((w) => `<li>${partTag(w)}<span class="w">${esc(w.text)}</span><button class="btn sec" data-w="${w.id}" data-s="rejected" aria-label="Remove ${esc(w.text)}">Remove</button></li>`).join("")}</ul>`;
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
  en = await (await fetch("/content/en.json", { cache: "no-store" })).json();
  ROUTE = expandRoute(en);
  try { pin = localStorage.getItem(PIN_KEY); } catch {}
  if (pin) return unlock();
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error();
    gate();
  } catch {
    serverOk = false; // no backend at all (offline Host Mode)
    start();
  }
})();
