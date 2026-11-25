/* The Ride — projector.
 * The route is 4 stops plus the arrival (content/en.json → stops), each an ordered list of steps.
 * The bike rides, the milestone appears and the persona is introduced once per stop (the arrival);
 * steps inside a stop change only the main panel.
 * Screens: lobby → intro → per stop: arrive → each step's phases (route.js → phasesOf) → … → closing.
 * Everything is saved in localStorage, so a reload resumes exactly.
 * The moderator view follows through a BroadcastChannel (same laptop, offline) and the server.
 */
import { flatten, phasesOf, isVote, isQuestion, isCloud, choicesOf, personaOf, milestoneParts, stopTotal, filled, fmt, nextLabel, placeholdersOf } from "./route.js";
import { buildBand, emblem, PIT_ICONS } from "./scenery.js";
import { isProfane } from "./profanity.js";

const $ = (s) => document.querySelector(s);
const STORE = "ride.state.v5"; // v5: 4 stops + arrival, fuel by turnout
const PIN_KEY = "ride.pin";
const MUTE_KEY = "ride.muted";
const RIDE_MS = 3000; // the ride between stops
const LETTERS = "ABCDEFGH";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("the-ride") : null;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let C, STEPS, last, band;
const stats = { arrivals: [], screens: [] }; // for the tests: every arrival (stop, km) and every screen shown, in order
let S;
let busy = false;
let sceneKey = "";
const live = { on: false, ws: null, wsOpen: false, pollTimer: null, pingTimer: null, reconnectTimer: null, chain: Promise.resolve(), lastOk: 0, lost: false, canReturn: false, riders: 0, lastCmd: 0, hostOnly: false };
const LOST_AFTER_MS = 5000; // Live server silent this long: switch to Host Mode
const openedAt = {}; // slot → when voting opened (this session)

const freshVote = (slot, duration) => ({ slot, duration, endsAt: null, left: duration * 1000, paused: false, locked: false });
const fresh = () => ({
  i: 0, phase: "lobby",
  manual: {}, final: {}, closed: {}, tallies: {},
  words: [], liveWords: [], pending: 0,
  timer: { endsAt: null, duration: 60 },
  vote: freshVote(null, 30),
  round: null, reached: 0,
});

// ------------------------------------------------------------------ sound (soft, generated, M mutes it)
const sound = {
  ctx: null,
  muted: (() => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } })(),
  wake() {
    if (this.ctx) return this.ctx.state === "suspended" && this.ctx.resume().catch(() => {});
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  },
  tone(freq, dur, at = 0, gain = 0.05) {
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  tick() { this.tone(1046, 0.06, 0, 0.035); },
  lock() { this.tone(523, 0.12, 0, 0.05); this.tone(392, 0.16, 0.09, 0.045); },
  reveal() { this.tone(659, 0.14, 0, 0.05); this.tone(988, 0.26, 0.12, 0.05); },
  fuel() { this.tone(523, 0.1, 0, 0.04); this.tone(659, 0.1, 0.08, 0.04); this.tone(784, 0.2, 0.16, 0.045); },
};
addEventListener("keydown", () => sound.wake(), { capture: true });
addEventListener("pointerdown", () => sound.wake(), { capture: true });
function toggleMute() {
  sound.muted = !sound.muted;
  try { localStorage.setItem(MUTE_KEY, sound.muted ? "1" : "0"); } catch {}
  toast(sound.muted ? "Sound off" : "Sound on");
}

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const U = (k, vars) => fmt(C.ui[k], vars);
const cfg = (k, d) => C?.config?.[k] ?? d;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const step = (i = S.i) => STEPS[i];
const stopOf = (s = step()) => C.stops[s.stopIndex];
const slotOf = (i = S.i) => STEPS[i].id; // votes, tallies and word clouds are keyed by step id
const tallyOf = (slot) => S.tallies[slot] || { n: 0, counts: {} };
const voting = () => ["ask", "locked", "reveal"].includes(S.phase) && isVote(step());
const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(h);
const voteUrl = () => (filled(cfg("publicUrl", "")) ? cfg("publicUrl", "").replace(/\/+$/, "") : location.origin) + "/v";
const shortUrl = () => voteUrl().replace(/^https?:\/\//, "");
/** A stable name for the screen on show (for the tests' forward walk). */
function screenId() {
  if (S.phase === "lobby") return "lobby";
  if (S.phase === "arrive") return `arrive:${stopOf().id}`;
  return phasesOf(step()).length > 1 ? `${step().id}:${S.phase}` : step().id;
}
function voteSeconds(s = step()) {
  return isCloud(s) ? cfg("cloudVoteSeconds", 60) : cfg("voteSeconds", 30);
}

function fit() {
  document.documentElement.style.setProperty("--scale", Math.min(innerWidth / 1920, innerHeight / 1080));
}
addEventListener("resize", fit);
fit();

// ------------------------------------------------------------------ fuel = participation
/** Fuel starts at 50%. Each question adds (answers ÷ riders) × 10%, each pump × 20%. Capped at 100%, never lost. */
function fuelGain(s, fin) {
  if (!fin) return 0;
  return fin.ratio * (s.type === "pump" ? cfg("fuelPerPump", 20) : cfg("fuelPerQuestion", 10));
}
function fuel() {
  let f = cfg("fuelStart", 50);
  for (const s of STEPS) f = Math.min(100, f + fuelGain(s, S.final[s.id]));
  return Math.round(f);
}
/** Turnout below 30% (Live): the gauge pulses and the moderator is told. While voting, only after a few seconds. */
function lowTurnout() {
  if (!live.on || !S || !voting() || !live.riders) return false;
  const s = step();
  const fin = S.final[s.id];
  if (fin) return fin.ratio < cfg("lowTurnout", 0.3);
  if (S.phase !== "ask") return false;
  const at = openedAt[s.id];
  return !!at && Date.now() - at > cfg("lowTurnoutAfterSeconds", 10) * 1000 && tallyOf(s.id).n / live.riders < cfg("lowTurnout", 0.3);
}

// ------------------------------------------------------------------ init
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Number.isInteger(s.i) && s.i >= 0 && s.i <= last) return { ...fresh(), ...s };
  } catch {}
  return fresh();
}
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {}
};

async function init() {
  try {
    C = await (await fetch("content/en.json", { cache: "no-store" })).json();
  } catch {
    $("#scene").innerHTML = `<div class="loadbox"><h1>The ride can't start yet</h1><p>The game content didn't load. Check the connection to the server, then reload this page.</p></div>`;
    return;
  }
  STEPS = flatten(C);
  last = STEPS.length - 1;
  try {
    await Promise.all(["700 40px Glacial", "400 30px Glacial", "italic 400 30px Glacial"].map((f) => document.fonts.load(f)));
  } catch {}
  // Every label on screen comes from en.json
  $("#fuel .g-read").firstChild.textContent = `${U("fuel")} `;
  $("#players span").textContent = U("riders");
  $("#answers span").textContent = U("answers");
  $("#modeBadge").textContent = U("hostMode");
  $("#qrCard b").textContent = U("scanToVote");
  band = buildBand($("#band"), C.stops, $("#bikeLayerSvg"));
  S = loadState();
  S.vote = { ...freshVote(null, 30), ...(S.vote || {}) };
  if (!PHASE_OK()) Object.assign(S, { phase: "lobby", i: 0 });
  band.setReached(Math.max(S.reached || 0, Math.max(0, step().stopIndex)));
  render();
  setInterval(tick, 250);
  // Live is the default. ?mode=host starts offline; without a reachable server it falls back to Host Mode by itself.
  if (wantLive()) enableLive(true);
  setInterval(watchdog, 1000);
  announce();
}
const wantLive = () => new URLSearchParams(location.search).get("mode") !== "host" && location.protocol.startsWith("http");
const PHASE_OK = () => S.phase === "lobby" || S.phase === "arrive" || phasesOf(step()).includes(S.phase);

// ------------------------------------------------------------------ HUD: where we are + the game strip
function hudWhere() {
  const s = step();
  if (S.phase === "lobby") return "";
  if (s.type === "intro") return U("beforeWeRide");
  const stop = stopOf(s);
  if (stop.arrival) return S.phase === "arrive" ? U("arrival") : `${U("arrival")} · ${stop.place}`;
  if (s.type === "pump") return U("onTheRoad", { place: C.stops[s.stopIndex + 1]?.place || stop.place }); // between two stops
  const n = U("stopN", { n: s.stopIndex + 1, total: stopTotal(C) });
  return S.phase === "arrive" ? n : `${n} · ${stop.place}`;
}

function renderFuel() {
  const f = fuel();
  $("#fuelPct").textContent = `${f}%`;
  $("#fuel").setAttribute("aria-label", `${U("fuel")} ${f}%`);
  $("#gFill").style.strokeDasharray = `${f} 100`;
  $("#fuel").classList.toggle("low", lowTurnout());
}

/** After a vote locks: a small note under the strip. Pumps say "The room fuelled the ride". */
function flashFuel(before, after, pump) {
  if (after <= before && !pump) return;
  const d = $("#fuelDelta");
  const plus = after - before;
  d.textContent = pump ? `${U("roomFuelled")}${plus > 0 ? ` · +${plus}%` : ""}` : U("fuelUp", { n: plus });
  d.className = "fuel-note up";
  void d.offsetWidth;
  d.classList.add("show");
  const g = $("#fuel");
  g.classList.remove("filling");
  void g.offsetWidth;
  g.classList.add("filling");
  sound.fuel();
}

/** A number that ticks up (or down) to its target. */
function setCount(el, n) {
  if (!el) return;
  el.dataset.target = Math.max(0, n | 0);
  if (el.dataset.shown == null) {
    el.dataset.shown = String(el.dataset.target);
    el.textContent = el.dataset.shown;
    return;
  }
  if (el.dataset.ticking) return;
  const tickTo = () => {
    const cur = Number(el.dataset.shown);
    const tgt = Number(el.dataset.target);
    if (cur === tgt || !el.isConnected) return delete el.dataset.ticking;
    const nx = reduceMotion() ? tgt : cur + Math.sign(tgt - cur) * Math.max(1, Math.ceil(Math.abs(tgt - cur) / 10));
    el.dataset.shown = nx;
    el.textContent = nx;
    el.dataset.ticking = "1";
    setTimeout(tickTo, 60);
  };
  tickTo();
}
let lastRiders = null;
/** Top right: fuel, "Question N of 7", riders joined and answers for the step on screen (Live), or a small Host mode badge. */
function updateStrip() {
  const s = step();
  const q = isQuestion(s) && S.phase !== "arrive" && S.phase !== "lobby" && !busy;
  $("#qnum").classList.toggle("hidden", !q);
  if (q) $("#qnum").textContent = U("questionN", { n: s.qn, total: s.qTotal });
  $("#players").classList.toggle("hidden", !live.on);
  $("#answers").classList.toggle("hidden", !(live.on && voting() && S.phase !== "showcase" && !busy));
  if (live.on) {
    setCount($("#playersN"), live.riders);
    if (lastRiders != null && live.riders > lastRiders && !reduceMotion()) {
      const p = $("#players");
      p.classList.remove("pulse");
      void p.offsetWidth;
      p.classList.add("pulse");
    }
    lastRiders = live.riders;
    setCount($("#ansCount"), voting() ? tallyOf(s.id).n : 0);
  }
  $("#modeBadge").classList.toggle("hidden", live.on);
}

// ------------------------------------------------------------------ render
/** How far the bike has crept forward at this stop: one nudge per finished vote. */
function stopProgress() {
  const s = step();
  if (S.phase === "lobby" || S.phase === "arrive" || s.stopIndex < 0) return 0;
  return STEPS.filter((x, i) => x.stopIndex === s.stopIndex && i <= S.i && S.final[x.id]).length;
}
const tallBand = () => S.phase === "lobby" || S.phase === "arrive" || ["intro", "persona"].includes(step().type);

function render() {
  const s = step();
  if (!busy) {
    $("#hudWhere").textContent = hudWhere();
    band.setStop(Math.max(0, s.stopIndex), stopProgress(), S.phase === "locked" ? 650 : 0); // after a vote locks, the bike creeps on
  }
  ensureVote();
  renderFuel();
  $("#stage").classList.toggle("band-short", !tallBand() && !busy);
  $("#stage").classList.toggle("band-tall", tallBand() || busy);

  const key = [S.i, S.phase, live.on].join("|");
  if (key !== sceneKey && !busy) {
    sceneKey = key;
    $("#scene").innerHTML = sceneHTML(s);
    if (S.phase === "lobby" && live.on) makeQR($("#qrBig"), voteUrl());
    if (s.link && filled(s.link.url) && s.qr) makeQR($("#qrLink"), s.link.url);
    if (stats.screens[stats.screens.length - 1] !== screenId()) stats.screens.push(screenId());
  }
  updateResults();
  if (S.phase === "lobby") setCount($("#ridersCount"), live.riders);
  fitScene();
  updateQR();
  updateStrip();
  renderVote();
  announce();
}

/** Fit: shrink the answers, then the left column, then the reveal sign. The question never shrinks. */
function fitScene() {
  const scene = $("#scene");
  const inner = scene.firstElementChild;
  if (!inner) return;
  const over = () => inner.scrollHeight > scene.clientHeight + 1 || inner.getBoundingClientRect().bottom > scene.getBoundingClientRect().bottom + 1;
  const parts = [".answers", ".ask-left", ".show-row", ".explain", ".infocard", ".closing"].map((sel) => inner.querySelector(sel)).filter(Boolean);
  for (const p of parts) p.style.zoom = "";
  for (const p of parts) {
    let z = 1;
    while (over() && z > 0.72) p.style.zoom = (z -= 0.04).toFixed(2);
  }
}
// The road band animates between tall and short; refit once the scene has its final height.
document.getElementById("scene").addEventListener("transitionend", (e) => {
  if (e.target.id === "scene" && e.propertyName === "bottom") fitScene();
});

// ------------------------------------------------------------------ scenes
function sceneHTML(s) {
  if (S.phase === "lobby") return lobbyHTML();
  if (S.phase === "arrive") return arriveHTML(s);
  switch (s.type) {
    case "intro": return introHTML(s);
    case "showcase": return showcaseHTML(s);
    case "question": return questionHTML(s);
    case "reveal": return revealStepHTML(s);
    case "persona": return personaStepHTML(s);
    case "infocard": return infocardHTML(s);
    case "pump": return pumpHTML(s);
    case "closing": return closingHTML(s);
  }
  return "";
}

/** Lobby: big QR, short URL and a live "riders on board" counter. Host Mode: the title only. */
function lobbyHTML() {
  const L = C.lobby;
  if (!live.on)
    return `<div class="intro lobby"><div class="card-big enter"><h1>${esc(L.hostTitle)}</h1><h2>${esc(C.subtitle)}</h2><p>${esc(L.hostLine)}</p></div></div>`;
  return `<div class="intro lobby">
    <div class="card-big enter">
      <h1>${esc(L.title)}</h1>
      <p>${esc(L.line)}</p>
      <div class="riders"><b id="ridersCount">0</b> <span>${esc(L.counter)}</span></div>
    </div>
    <div class="qr-panel enter-2"><div class="qr" id="qrBig"></div><b>${esc(U("scanToVote"))}</b><span>${esc(shortUrl())}</span></div></div>`;
}

function introHTML(s) {
  const facts = (s.facts || []).filter(filled);
  return `<div class="intro">
    <div class="card-big enter">
      <h1>${esc(s.title)}</h1>
      <p>${esc(s.line)}</p>
      <h2 class="mission">${esc(s.mission)}</h2>
      ${facts.length ? `<div class="facts">${facts.map((f) => `<div class="fact">${esc(f)}</div>`).join("")}</div>` : ""}
    </div></div>`;
}

/** The persona: badge, name, role, and optionally one italic line. */
function personaHTML(p, line = "", size = 92, big = false) {
  if (!p) return "";
  return `<div class="persona ${big ? "big" : ""} enter">
    <div class="pic">${emblem(p.badge, size)}</div>
    <div class="who"><div class="p-name">${esc(p.name)}</div>${p.role ? `<div class="p-role">${esc(p.role)}</div>` : ""}</div>
    ${line ? `<p class="p-voice">“${esc(line)}”</p>` : ""}</div>`;
}

/** Arrival at a stop (once per stop): the milestone (place, theme, km) and the persona with the opening line. */
function arriveHTML(s) {
  const stop = stopOf(s);
  const [head, sub] = milestoneParts(stop);
  const p = stop.persona ? { id: stop.persona, ...C.personas[stop.persona] } : null;
  return `<div class="arrive ${p ? "" : "solo"}">
    <div class="stone enter"><div class="stone-top"></div><div class="stone-place ${head.length > 12 ? "long" : ""}">${esc(head)}</div>
      ${sub ? `<div class="stone-sub">${esc(sub)}</div>` : ""}<div class="stone-en">${esc(stop.theme)}</div><div class="stone-km">${stop.km.toLocaleString("en-IN")} km</div></div>
    ${p ? `<div class="arrive-right">${personaHTML(p, stop.voice, 150, true)}</div>` : ""}</div>`;
}

/** The question card, with the voting countdown and the "Votes locked" tag under it. */
const countdownHTML = () => `<div class="countdown" id="countdown" aria-hidden="true"><i id="cdFill"></i></div><span class="locked-tag hidden" id="lockedTag">${esc(U("votesLocked"))}</span>`;
const boardQ = (s) => `<div class="signboard enter-2"><div class="q-en">${esc(s.question)}</div>${countdownHTML()}</div>`;

// Answer rows: a white row with a letter, the text, a big percentage and an arrow. The face is drawn twice:
// the second copy is the teal tint, clipped to the vote share (--p), so the fill grows from the left.
const ARROW = `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M3 16 H40 M27 4 L42 16 L27 28" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const gridCls = (n) => (n === 4 || n === 2 ? "grid2" : "grid1");
/** variant: "" (answer row) | "chip" (pick-n chip) */
function signHTML(id, k, text, keyLabel, variant = "") {
  const face = (fill) => `<div class="ds-face${fill ? " ds-fill" : ""}"${fill ? ' aria-hidden="true"' : ""}><span class="key">${esc(keyLabel ?? LETTERS[k])}</span><div class="ds-text"><div class="en">${esc(text)}</div></div><span class="ds-pct"></span>${variant ? "" : `<span class="ds-arrow">${ARROW}</span>`}</div>`;
  return `<div class="dsign ${variant} ghost" data-o="${esc(id)}"><div class="flagbar"></div><div class="ds-body">${face(false)}${face(true)}</div></div>`;
}
function answersHTML(s) {
  switch (s.format) {
    case "choose":
      return `<div class="dsigns ${gridCls(s.options.length)}">${s.options.map((o, k) => signHTML(o.id, k, o.text)).join("")}</div>`;
    case "pickn":
      return `<div class="dsigns chips">${s.items.map((o, k) => signHTML(o.id, k, o.text, k + 1, "chip")).join("")}</div>`;
    case "wordcloud":
      return cloudHTML("cloud", "", "single");
    case "dualcloud":
      return `<div class="clouds">${s.parts.map((pt) => cloudHTML(`cloud-${pt.id}`, pt.title, pt.color)).join("")}</div>`;
  }
  return "";
}
const cloudHTML = (id, title, cls) => `<div class="cloudwrap ${cls}">${title ? `<h4 class="cloud-title">${esc(title)}</h4>` : ""}<div class="cloud empty" id="${id}"></div></div>`;
/** Host Mode only: what the room should do (show of hands). */
const hintHTML = () => `<div class="hint" id="hostHint"></div>`;

function questionHTML(s) {
  const p = personaOf(C, s);
  return `<div class="ask ${s.format === "dualcloud" ? "dual" : ""} ${p ? "" : "wide"}">
    ${p ? `<div class="ask-left">${personaHTML(p)}</div>` : ""}
    <div class="ask-main">
      ${boardQ(s)}
      <div class="answers enter-3">${answersHTML(s)}${hintHTML()}</div>
    </div></div>`;
}

/** Stop 1: one screen, three states. The websites; then the question under smaller cards; then the cards flip. */
function showcaseHTML(s) {
  const st = S.phase;
  const card = (site) => {
    const facts = [["builtBy", site.builtBy], ["took", site.took], ["cost", site.cost]].filter(([, v]) => filled(v));
    return `<div class="show-card"><div class="show-flip">
      <div class="show-front">${site.image ? `<img class="show-img" src="${esc(site.image)}" alt="${esc(`The ${site.title} website`)}"/>` : ""}<div class="show-title">${esc(site.title)}</div></div>
      <div class="show-back" aria-hidden="${st === "reveal" ? "false" : "true"}"><div class="show-title">${esc(site.title)}</div>
        ${facts.length ? `<dl class="show-facts">${facts.map(([k, v]) => `<div><dt>${esc(U(k))}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : `<div class="show-url">${esc(site.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</div>`}</div>
    </div></div>`;
  };
  const cards = `<div class="show-row ${st === "showcase" ? "big" : "small"} ${st === "reveal" ? "flipped" : ""}">${s.sites.map(card).join("")}</div>`;
  if (st === "showcase") return `<div class="showcase enter">${cards}<p class="show-line enter-2">${esc(s.line)}</p></div>`;
  return `<div class="showcase">
    ${cards}
    ${st === "reveal" ? `<div class="explain">${esc(s.reveal)}</div>` : ""}
    ${boardQ(s)}
    <div class="answers">${answersHTML(s)}${hintHTML()}</div></div>`;
}

/** A reveal: the persona on the left, the line on a white card, the takeaway as a marigold road sign. */
function revealStepHTML(s) {
  const p = personaOf(C, s);
  return `<div class="ask ${p ? "" : "wide"}">
    ${p ? `<div class="ask-left">${personaHTML(p)}</div>` : ""}
    <div class="ask-main reveal-main">
      ${s.takeaway ? `<div class="signboard enter"><div class="q-en">${esc(s.text)}</div></div><div class="explain big">${esc(s.takeaway)}</div>` : `<div class="explain big">${esc(s.text)}</div>`}
    </div></div>`;
}

/** A second persona met at the same stop: the persona, big, with their line. */
function personaStepHTML(s) {
  return `<div class="meet">${personaHTML(personaOf(C, s), s.line, 150, true)}</div>`;
}

function infocardHTML(s) {
  const link = s.link && filled(s.link.url);
  return `<div class="pit card-pit"><div class="board enter infocard">
    <div class="board-text">${esc(s.title)}</div>
    ${s.rows ? `<table class="token-table enter-2">${s.rows.map((r) => `<tr><td>${esc(r.from)}</td><td class="arr" aria-hidden="true">${ARROW}</td><td class="tok">${esc(r.to)}</td></tr>`).join("")}</table>` : ""}
    <div class="card-text">${esc(s.text)}</div>
    ${link ? `<div class="card-link">${s.qr ? `<div class="qr" id="qrLink"></div>` : ""}<span>${esc(s.link.url.replace(/^https?:\/\//, ""))}</span></div>` : ""}</div>
    <div class="pit-icon enter-2">${PIT_ICONS.info}</div></div>`;
}

function pumpHTML(s) {
  const locked = S.phase === "locked";
  return `<div class="pit pump">
    <div class="pit-q">${boardQ(s)}
      <div class="answers">${answersHTML(s)}${hintHTML()}</div>
      ${locked ? `<div class="explain">${esc(s.resultLine)}</div>` : ""}</div>
    <div class="pump-side enter"><div class="pit-icon">${PIT_ICONS.petrol}</div><div class="board-kind">${esc(s.board)}</div></div></div>`;
}

function closingHTML(s) {
  return `<div class="closing-wrap"><div class="closing enter"><p>${esc(s.text)}</p><div class="final-line enter-2">${esc(s.finalLine)}</div></div></div>`;
}

// ------------------------------------------------------------------ live results (updated in place, no re-animation)
function setFlags(el, flags) {
  const bar = el.querySelector(".flagbar");
  if (bar) bar.innerHTML = flags.map(([cls, txt]) => `<span class="flag ${cls}">${esc(txt)}</span>`).join("");
}
/** Grow the fill to p% and write the big percentage; null text = no answers yet (ghost). */
function setFill(el, p, txt) {
  if (!el) return;
  el.style.setProperty("--p", `${Math.max(0, Math.min(100, p))}%`);
  el.classList.toggle("ghost", txt == null);
  el.querySelectorAll(".ds-pct").forEach((x) => (x.textContent = txt ?? ""));
}
const partOf = (w) => w.part || "";
const wordsFor = (part = "") => (live.on ? S.liveWords : S.words).filter((w) => partOf(w) === part);
function renderCloud(box, words, settled, lo, hi) {
  if (!box) return;
  const max = Math.max(1, ...words.map((w) => w.n));
  const list = settled ? [...words].sort((a, b) => b.n - a.n) : words;
  const key = JSON.stringify([list.map((w) => [w.text, w.n]), settled]);
  box.classList.toggle("empty", !words.length);
  box.classList.toggle("settled", settled);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = words.length
    ? list.map((w) => `<span class="w" style="font-size:${lo + Math.round((w.n / max) * (hi - lo))}px">${esc(w.text)}</span>`).join("")
    : `<span class="cloud-empty">${esc(U("cloudEmpty"))}</span>`;
}

/** The room's result for a vote step: the leading choice (choose / pump) or the top n (pick-n). */
function roomResult(s) {
  const t = tallyOf(s.id);
  const m = S.manual[s.id] || {};
  const ids = choicesOf(s).map((o) => o.id);
  if (s.format === "pickn") {
    if (m.picks?.length) return { picks: m.picks };
    if (!t.n) return {};
    return { picks: [...ids].sort((a, b) => (t.counts[b] || 0) - (t.counts[a] || 0) || ids.indexOf(a) - ids.indexOf(b)).slice(0, s.n) };
  }
  if (m.choice) return { choice: m.choice };
  const max = Math.max(0, ...ids.map((id) => t.counts[id] || 0));
  return max ? { choice: ids.find((id) => (t.counts[id] || 0) === max) } : {};
}

function updateResults() {
  if (!voting() || S.phase === "showcase") return;
  const s = step();
  const t = tallyOf(s.id);
  const locked = S.phase !== "ask";
  const m = S.manual[s.id] || {};
  const r = roomResult(s);
  if (s.format === "choose" || s.format === "pickn") {
    document.querySelectorAll(".answers .dsign").forEach((el) => {
      const id = el.dataset.o;
      let p = pct(t.counts[id] || 0, t.n);
      let txt = t.n ? `${p}%` : null;
      if (!t.n && (m.choice || m.picks)) {
        const on = m.choice === id || m.picks?.includes(id); // Host Mode: the room's pick, typed in
        p = on ? 100 : 0;
        txt = null;
      }
      setFill(el, p, txt);
      const lead = s.format === "pickn" ? r.picks?.includes(id) : r.choice === id;
      el.classList.toggle("lead", !!lead);
      el.classList.toggle("out", locked && !lead && !!(r.choice || r.picks));
      const label = s.format === "pickn" ? U("roomsTop", { n: s.n }) : locked || m.choice ? U("roomsPick") : U("leading");
      setFlags(el, lead ? [["room", label]] : []);
    });
  } else if (s.format === "wordcloud") renderCloud($("#cloud"), wordsFor(""), locked, 34, 84);
  else if (s.format === "dualcloud") s.parts.forEach((pt) => renderCloud($(`#cloud-${pt.id}`), wordsFor(pt.id), locked, 26, 60));
  const hint = $("#hostHint");
  if (hint) hint.textContent = live.on || locked ? "" : hostHint(s);
}
function hostHint(s) {
  if (s.format === "pickn") return U("hostHintPick", { n: s.n });
  if (isCloud(s)) return U("hostHintCloud");
  return U("hostHintChoose");
}

// ------------------------------------------------------------------ Host Mode entry (also overrides Live)
function entryHelp(s) {
  if (!isVote(s) || S.phase !== "ask") return "";
  if (s.format === "pickn") return `Keys 1–${s.items.length}: toggle the room's top ${s.n}. 0 clears.`;
  if (s.format === "wordcloud") return "W adds an answer to the cloud.";
  if (s.format === "dualcloud") return `W adds to “${s.parts[0].title}”, N adds to “${s.parts[1].title}”.`;
  return `Keys A–${LETTERS[s.options.length - 1]}: the room's pick. 0 clears.`;
}
function enter(index) {
  if (busy || S.phase !== "ask") return;
  const s = step();
  if (!isVote(s) || isCloud(s)) return;
  if (index === -1) {
    delete S.manual[s.id];
    return commit();
  }
  const m = (S.manual[s.id] = { ...(S.manual[s.id] || {}) });
  const list = choicesOf(s);
  if (index >= list.length) return;
  const id = list[index].id;
  if (s.format === "pickn") {
    m.picks = m.picks || [];
    if (m.picks.includes(id)) m.picks = m.picks.filter((x) => x !== id);
    else if (m.picks.length < s.n) m.picks.push(id);
    else toast(`The room's top ${s.n} is full. Press a picked number again to remove it, or 0 to clear.`);
  } else m.choice = m.choice === id ? undefined : id;
  commit();
}

// ------------------------------------------------------------------ flow
/** Ride between stops (never between steps of one stop). */
async function rideTo(target) {
  busy = true;
  const from = S.i;
  const t = STEPS[target];
  const dest = C.stops[t.stopIndex];
  $("#stage").classList.remove("band-short");
  $("#stage").classList.add("band-tall");
  $("#scene").innerHTML = `<div class="riding"><span class="sr-only">${esc(U("onTheRoad", { place: dest.place }))}</span></div>`;
  $("#hudWhere").textContent = target > from ? U("onTheRoad", { place: dest.place }) : dest.place;
  sceneKey = "";
  $("#qrCard").classList.add("hidden");
  updateStrip();
  if (live.on) syncServer({ slot: t.id, phase: "arrive" });
  let shown = false;
  await band.ride(Math.max(0, STEPS[from].stopIndex), t.stopIndex, RIDE_MS, (e) => {
    if (!shown && e > 0.55 && target > from) {
      shown = true;
      S.reached = Math.max(S.reached || 0, t.stopIndex);
      band.setReached(S.reached, true);
    }
  });
  busy = false;
}

async function next() {
  if (busy) return;
  const s = step();
  if (S.phase === "lobby") {
    S.i = 0;
    S.phase = "show";
    return commit();
  }
  if (S.phase === "arrive") {
    S.phase = phasesOf(s)[0];
    return commit();
  }
  if (S.phase === "ask") return lockVotes();
  const ph = phasesOf(s);
  const k = ph.indexOf(S.phase);
  if (k < ph.length - 1) {
    S.phase = ph[k + 1];
    commit();
    if (S.phase === "reveal") sound.reveal();
    return;
  }
  return advance();
}
/** Forward to the next step: the same stop changes only the main panel; a new stop rides and arrives. */
async function advance() {
  if (S.i >= last) return;
  const s = step();
  const nx = STEPS[S.i + 1];
  S.timer = { endsAt: null, duration: S.timer.duration };
  if (nx.stopIndex === s.stopIndex) {
    S.i++;
    S.phase = phasesOf(nx)[0];
    return commit();
  }
  if (s.stopIndex >= 0) await rideTo(S.i + 1); // the first stop is where the ride starts: no ride to it
  S.i++;
  S.phase = "arrive";
  S.reached = Math.max(S.reached || 0, nx.stopIndex);
  band.setReached(S.reached);
  stats.arrivals.push({ stop: C.stops[nx.stopIndex].id, km: C.stops[nx.stopIndex].km });
  commit();
}

async function back() {
  if (busy) return;
  const s = step();
  const lastPhase = () => {
    const ph = phasesOf(step());
    S.phase = ph[ph.length - 1];
  };
  if (S.phase === "lobby") return;
  if (s.type === "intro") S.phase = "lobby";
  else if (S.phase === "arrive") {
    if (s.stopIndex === 0) {
      S.i = 0;
      S.phase = "show";
    } else {
      await rideTo(S.i - 1);
      S.i--;
      lastPhase();
    }
  } else if (S.phase === "locked") {
    // Undo the lock: the result comes off, votes stay closed until reopened (V or the moderator)
    delete S.final[s.id];
    S.phase = "ask";
  } else {
    const ph = phasesOf(s);
    const k = ph.indexOf(S.phase);
    if (k > 0) S.phase = ph[k - 1];
    else if (s.stepIndex === 0) S.phase = "arrive";
    else {
      S.i--;
      lastPhase();
    }
  }
  commit();
}

// ------------------------------------------------------------------ the voting countdown
const voteView = () => {
  const v = S.vote;
  const left = v.locked ? 0 : v.paused || !v.endsAt ? v.left : Math.max(0, v.endsAt - Date.now());
  return { slot: v.slot, duration: v.duration, remainingMs: left, paused: !!v.paused, locked: !!v.locked, running: !!v.endsAt && !v.paused && !v.locked };
};
/** A vote step on screen: start its countdown once. A step counted down before keeps its state (back / reload). */
function ensureVote() {
  if (S.phase !== "ask" || busy) return;
  const slot = slotOf();
  if (S.vote.slot === slot) return;
  const d = voteSeconds();
  S.vote = { ...freshVote(slot, d), endsAt: S.closed[slot] ? null : Date.now() + d * 1000, locked: !!S.closed[slot] };
  lastTick = 0;
  save();
}
/** Lock votes: phones lock, the bars freeze, "Votes locked" shows, the room's result settles and fuel is added. */
function lockVotes(auto = false) {
  if (S.phase !== "ask") return;
  const s = step();
  const before = fuel();
  S.vote = { ...S.vote, locked: true, endsAt: null, paused: false, left: 0 };
  S.closed[s.id] = true;
  const t = tallyOf(s.id);
  const riders = live.on ? live.riders : null;
  // Host Mode can't count phones: the room answers by show of hands, so it counts as everyone on board.
  const ratio = live.on ? (riders ? Math.min(1, t.n / riders) : 0) : 1;
  S.final[s.id] = { n: t.n, riders, ratio };
  S.phase = "locked";
  sound.lock();
  commit();
  flashFuel(before, fuel(), s.type === "pump");
  if (auto) toast("Time's up: votes locked.", 2500);
}
function reopenVotes(seconds = 15) {
  const s = step();
  if (!isVote(s) || !["ask", "locked"].includes(S.phase)) return;
  delete S.final[s.id];
  delete S.closed[s.id];
  S.phase = "ask";
  S.vote = { slot: s.id, locked: false, paused: false, endsAt: Date.now() + seconds * 1000, left: seconds * 1000, duration: Math.max(S.vote.duration || 0, seconds) };
  commit();
}
function pauseVote() {
  if (S.phase !== "ask" || S.vote.locked) return;
  const v = S.vote;
  S.vote = v.paused ? { ...v, paused: false, endsAt: Date.now() + v.left } : { ...v, paused: true, left: Math.max(0, v.endsAt - Date.now()), endsAt: null };
  toast(S.vote.paused ? "Countdown paused" : "Countdown running", 1600);
  commit();
}
function extendVote(seconds = 15) {
  if (S.phase !== "ask") return;
  if (S.vote.locked) return reopenVotes(seconds);
  const v = S.vote;
  const left = (v.paused ? v.left : Math.max(0, v.endsAt - Date.now())) + seconds * 1000;
  S.vote = { ...v, left, endsAt: v.paused ? null : Date.now() + left, duration: Math.max(v.duration, Math.ceil(left / 1000)) };
  toast(`+${seconds} seconds`, 1400);
  commit();
}
/** V / the moderator: lock now, or reopen (15 more seconds). */
function toggleVote() {
  if (S.phase === "ask" && !S.vote.locked) return lockVotes();
  if (S.phase === "ask" || S.phase === "locked") return reopenVotes(15);
}
let lastTick = 0;
/** Every 250 ms: empty the bar, tick softly in the last 5 seconds, lock at zero. */
function renderVote() {
  const bar = $("#cdFill");
  const v = voteView();
  const onStep = S.phase === "ask" && v.slot === slotOf();
  const locked = (onStep && v.locked) || S.phase === "locked" || S.phase === "reveal";
  const cd = $("#countdown");
  if (cd) {
    cd.classList.toggle("hidden", !onStep || v.locked);
    cd.classList.toggle("paused", v.paused);
    cd.classList.toggle("ending", v.running && v.remainingMs <= 5000);
  }
  if (bar && onStep) bar.style.transform = `scaleX(${v.duration ? Math.min(1, v.remainingMs / (v.duration * 1000)) : 0})`;
  $("#lockedTag")?.classList.toggle("hidden", !locked);
  document.querySelector("#scene > *")?.classList.toggle("locked", locked);
  if (!onStep || !v.running) return;
  const sec = Math.ceil(v.remainingMs / 1000);
  if (sec <= 5 && sec >= 1 && sec !== lastTick) {
    lastTick = sec;
    sound.tick();
  }
  if (v.remainingMs <= 0) lockVotes(true);
}

/** Host Mode (or a presenter extra in Live): add an answer to the word cloud. Two clouds: W = first, N = second. */
async function addWord(which = 0) {
  const s = step();
  if (!isCloud(s) || !["ask", "locked"].includes(S.phase)) return;
  const part = s.format === "dualcloud" ? s.parts[which] : null;
  if (which && !part) return;
  const text = await modal({ title: part ? `Add to “${part.title}”` : "Add to the word cloud", text: "Type an answer from the room (up to 40 characters).", input: true, inputType: "text", ok: "Add it" });
  return addWordText(text, which);
}
async function addWordText(text, which = 0) {
  const s = step();
  if (!text || !isCloud(s) || !["ask", "locked"].includes(S.phase)) return;
  const part = s.format === "dualcloud" ? s.parts[which] : null;
  if (which && !part) return;
  const clean = String(text).replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) return;
  if (isProfane(clean)) return toast("That one was filtered. Try different words.");
  if (live.on) {
    try { await adminCall({ action: "addWord", text: clean, ...(part ? { part: part.id } : {}) }); } catch { toast("Couldn't reach the server. Try again in a moment."); }
    return;
  }
  const hit = S.words.find((w) => w.slot === s.id && partOf(w) === (part?.id || "") && w.text.toLowerCase() === clean.toLowerCase());
  if (hit) hit.n++;
  else S.words.push({ slot: s.id, text: clean, n: 1, ...(part ? { part: part.id } : {}) });
  commit();
}

function commit() {
  $("#toast").classList.remove("show");
  save();
  render();
  if (live.on) syncServer();
}

// ------------------------------------------------------------------ discussion timer (moderator only)
const timerRunning = () => !!(S?.timer?.endsAt && S.timer.endsAt > Date.now());
function setTimer(cmd, duration, fromRemote) {
  const d = Number(duration) || S.timer.duration || cfg("timerSeconds", 60);
  S.timer = cmd === "start" ? { endsAt: Date.now() + d * 1000, duration: d, startedAt: Date.now() } : { endsAt: null, duration: d };
  save();
  announce();
  if (live.on && !fromRemote) adminCall({ action: "timer", cmd, duration: d }).catch(() => {});
}
let lastAnnounce = 0;
function tick() {
  if (!S) return;
  renderVote();
  renderFuel();
  if (performance.now() - lastAnnounce > 1000) announce(); // keeps the moderator's countdown fresh
}

// ------------------------------------------------------------------ QR, toast, modal
function makeQR(target, url) {
  if (!target) return;
  try {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {}
}
function updateQR() {
  const card = $("#qrCard");
  if (live.on && card.dataset.url !== voteUrl()) {
    makeQR($("#qrSmall"), voteUrl());
    $("#qrUrl").textContent = shortUrl();
    card.dataset.url = voteUrl();
  }
  const open = live.on && S.phase === "ask" && !S.vote.locked && !busy;
  card.classList.toggle("hidden", !open); // only while voting is open
  if (open && !openedAt[slotOf()]) openedAt[slotOf()] = Date.now();
}
let toastT;
let lastToast = { text: "", at: 0 };
/** A short message: small on the projector (for keyboard use) and repeated in the moderator view. */
function toast(msg, ms = 3800) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
  lastToast = { text: msg, at: Date.now() };
  announce();
}
let modalOpen = false;
function modal({ title, text, input, inputType = "password", ok, error = "" }) {
  return new Promise((resolve) => {
    modalOpen = true;
    $("#modalBox").innerHTML = `<h3 id="modalTitle">${esc(title)}</h3><p>${esc(text)}</p>${input ? `<input id="modalInput" type="${inputType}" maxlength="60" autocomplete="off" aria-labelledby="modalTitle" />` : ""}<div class="err" role="alert">${esc(error)}</div><div class="row"><button type="button" id="modalCancel">Cancel</button><button type="button" class="go" id="modalOk">${esc(ok)}</button></div>`;
    $("#modal").classList.remove("hidden");
    const inp = $("#modalInput");
    (inp || $("#modalOk")).focus();
    const done = (v) => {
      modalOpen = false;
      $("#modal").classList.add("hidden");
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const submit = () => done(input ? inp.value.trim() : "");
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submit(); }
    };
    document.addEventListener("keydown", onKey, true);
    $("#modalCancel").onclick = () => done(null);
    $("#modalOk").onclick = submit;
  });
}

/** fromModerator: the moderator view already asked for confirmation (and the PIN), so no prompt here. */
async function resetGame(fromModerator = false) {
  const pin = fromModerator ? localStorage.getItem(PIN_KEY) ?? "" : await modal({ title: "Reset the ride?", text: live.on ? "This clears every answer and word on the server and returns to the lobby. Enter the PIN to confirm." : "This clears the room's answers and returns to the lobby.", input: live.on, ok: "Reset the ride" });
  if (pin === null) return;
  if (live.on) {
    try {
      const r = await adminCall({ action: "reset" }, pin);
      if (r.status === 401) return toast("That PIN didn't match. Nothing was reset.");
      if (!r.ok) return toast("The server couldn't reset the ride. Nothing changed.");
      try { localStorage.setItem(PIN_KEY, pin); } catch {}
      S = fresh();
      S.round = r.data.state.round;
    } catch {
      return toast("Couldn't reach the server. Nothing was reset.");
    }
  } else S = fresh();
  sceneKey = "";
  band.setReached(0);
  stats.arrivals.length = 0;
  commit();
  toast("Ride reset. Ready in the lobby.");
}

// ------------------------------------------------------------------ moderator: notes and remote control
/** What the moderator view needs to follow the projector and drive it (same laptop: BroadcastChannel). */
function announce() {
  if (!channel || !S || !STEPS) return;
  lastAnnounce = performance.now();
  const s = step();
  const t = voting() ? tallyOf(s.id) : null;
  channel.postMessage({
    type: "state", i: S.i, phase: S.phase, slot: s.id, mode: live.on ? "live" : "host", busy,
    lost: live.lost && !live.on, canReturn: live.canReturn && !live.on, privateHost: live.on && isPrivateHost(new URL(voteUrl()).hostname),
    n: t?.n || 0, counts: t?.counts || {}, riders: live.riders, low: lowTurnout(), fuel: fuel(),
    timer: S.timer, vote: voteView(), muted: sound.muted, manual: S.manual[s.id] || null,
    help: entryHelp(s), toast: lastToast, words: S.words.filter((w) => w.slot === s.id), at: Date.now(),
  });
}
/** A command from the moderator view (BroadcastChannel or relayed by the server). */
function runCommand(c) {
  if (!c || !S || modalOpen) return;
  switch (c.cmd) {
    case "next": case "back": case "timer": case "mode": case "returnLive":
      return act(c.cmd);
    case "closeVote": return toggleVote();
    case "pause": return pauseVote();
    case "extend": return extendVote(Number(c.arg) || 15);
    case "addWord": return addWordText(c.text, Number(c.arg) || 0);
    case "key": return typeof c.key === "string" && handleKey(c.key);
    case "mute": return toggleMute();
    case "reset": return resetGame(true);
  }
}
if (channel)
  channel.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === "timer") setTimer(m.cmd, m.duration, m.viaServer);
    if (m.type === "hello") announce();
    if (m.type === "cmd") runCommand(m);
  };

// ------------------------------------------------------------------ Live mode
async function fetchT(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal, cache: "no-store" }); } finally { clearTimeout(t); }
}
async function adminCall(body, pin) {
  const r = await fetchT(`${location.origin}/api/admin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pin: pin ?? localStorage.getItem(PIN_KEY) }) });
  let data = null;
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}
/** Is a Live server there? A plain static server (npm run host) answers { hostOnly: true }. */
async function serverUp(ms) {
  const r = await fetchT(`${location.origin}/api/state`, {}, ms);
  if (!r.ok) return false;
  const st = await r.json().catch(() => null);
  if (st?.hostOnly) live.hostOnly = true;
  return !!st && !st.hostOnly;
}
async function enableLive(silent) {
  if (!location.protocol.startsWith("http")) return toast("Live voting needs the game served from the Cloudflare Worker.");
  let up = false;
  try { up = await serverUp(4000); } catch {}
  if (!up) return fallbackToHost(silent || live.hostOnly ? null : "Can't reach the live server. Staying in Host mode; it reconnects when the server is back.");
  let pin = null;
  try { pin = localStorage.getItem(PIN_KEY); } catch {}
  let error = "";
  for (let k = 0; k < 5; k++) {
    if (!pin) {
      pin = await modal({ title: "Go live", text: "Enter the presenter PIN.", input: true, ok: "Go live", error });
      if (pin === null) return fallbackToHost(null);
    }
    let r;
    try { r = await adminCall({ action: "check" }, pin); } catch { return fallbackToHost("Can't reach the live server. Staying in Host mode (press L to try again)."); }
    if (r.status === 401) {
      pin = null;
      error = "That PIN didn't match. Try again.";
      try { localStorage.removeItem(PIN_KEY); } catch {}
      continue;
    }
    if (!r.ok) return fallbackToHost("The live server isn't ready. Staying in Host mode.");
    try { localStorage.setItem(PIN_KEY, pin); } catch {}
    if (S.round && S.round !== r.data.state.round) {
      S.tallies = {};
      S.closed = {};
    }
    S.round = r.data.state.round;
    const wasLost = live.lost;
    Object.assign(live, { on: true, lost: false, canReturn: false, lastOk: Date.now() });
    $("#qrCard").dataset.url = "";
    sceneKey = "";
    connectWS();
    startPolling();
    commit(); // pushes the current step to the server: the game carries on where it is
    if (!silent || wasLost) toast(wasLost ? "Back to Live. Phones rejoin on the current step." : `Live voting on: ${shortUrl()}`);
    return;
  }
}
/** Host Mode. After losing the server, keep checking; offer "Return to Live" when it answers again. */
function fallbackToHost(msg) {
  const was = live.on;
  live.on = false;
  live.wsOpen = false;
  if (was) live.lost = true;
  clearInterval(live.pollTimer);
  clearInterval(live.pingTimer);
  clearTimeout(live.reconnectTimer);
  if (live.ws) {
    live.ws.onclose = null;
    try { live.ws.close(); } catch {}
    live.ws = null;
  }
  // keep the approved words of the cloud on screen
  const s = step();
  for (const w of S.liveWords || []) if (!S.words.find((x) => x.slot === s.id && x.text === w.text && partOf(x) === partOf(w))) S.words.push({ ...w, slot: s.id });
  sceneKey = "";
  save();
  render();
  if (msg) toast(msg, was ? 6000 : 4000);
}
let lastHealth = 0;
/** Every second: Live silent > 5 s → Host Mode; in Host Mode, every 3 s check whether the server is back. */
function watchdog() {
  const now = Date.now();
  if (live.on && now - live.lastOk > LOST_AFTER_MS) return fallbackToHost("Lost the live server for 5 seconds. Switched to Host mode; answers so far are kept.");
  if (!live.on && !live.hostOnly && S && wantLive() && now - lastHealth > 3000) {
    lastHealth = now;
    serverUp(2000)
      .then((ok) => {
        if (ok !== live.canReturn) {
          live.canReturn = ok;
          if (ok && live.lost) toast("The live server is back. Press L, or Return to Live in the moderator view.", 6000);
          announce();
        }
      })
      .catch(() => {
        if (live.canReturn) {
          live.canReturn = false;
          announce();
        }
      });
  }
}
function connectWS() {
  if (!live.on) return;
  try {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws?role=presenter`);
    live.ws = ws;
    ws.onopen = () => {
      live.wsOpen = true;
      live.lastOk = Date.now();
      clearInterval(live.pingTimer);
      live.pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 2000); // keeps lastOk fresh
    };
    ws.onmessage = (ev) => {
      live.lastOk = Date.now();
      if (ev.data === "pong") return;
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "state") applyServerState(m.state);
        if (m.type === "cmd") serverCommand(m.cmd);
      } catch {}
    };
    ws.onclose = () => {
      live.wsOpen = false;
      clearInterval(live.pingTimer);
      if (live.on) live.reconnectTimer = setTimeout(connectWS, 1500);
    };
  } catch {
    live.reconnectTimer = setTimeout(connectWS, 3000);
  }
}
function startPolling() {
  clearInterval(live.pollTimer);
  live.pollTimer = setInterval(async () => {
    if (!live.on || live.wsOpen) return;
    try {
      const r = await fetchT(`${location.origin}/api/state?role=presenter`, {}, 2500);
      if (!r.ok) return;
      live.lastOk = Date.now();
      applyServerState(await r.json());
    } catch {} // the watchdog switches to Host Mode after 5 s without any answer
  }, 1000);
}
/** A moderator command relayed by the server (the moderator on a phone). Each runs once, and only while fresh. */
function serverCommand(c) {
  if (!c || typeof c.id !== "number" || c.id <= live.lastCmd) return;
  live.lastCmd = c.id;
  if ((c.age ?? 0) < 4000) runCommand(c);
}
function applyServerState(st) {
  if (!st || !live.on) return;
  if (st.round !== S.round) {
    S.round = st.round;
    S.tallies = {};
  }
  if (st.cmd) serverCommand(st.cmd); // polling fallback: the last relayed command
  // Tallies only for the step on screen; nothing carries over between steps
  if (st.tally && st.slot === slotOf() && !S.final[st.slot]) S.tallies[st.slot] = st.tally;
  if (typeof st.riders === "number") live.riders = st.riders;
  if (Array.isArray(st.words)) S.liveWords = st.slot === slotOf() ? st.words : [];
  if (typeof st.pending === "number") S.pending = st.pending;
  const freshT = S.timer.endsAt && Date.now() - (S.timer.startedAt || 0) < 4000;
  if (st.timer && !(freshT && !st.timer.running)) {
    const endsAt = st.timer.running ? Date.now() + st.timer.remainingMs : null;
    if (!!endsAt !== !!S.timer.endsAt || Math.abs((endsAt || 0) - (S.timer.endsAt || 0)) > 1500) S.timer = { ...S.timer, endsAt, duration: st.timer.duration };
  }
  save();
  updateResults();
  if (S.phase === "lobby") setCount($("#ridersCount"), live.riders);
  updateStrip();
  renderFuel();
}
/** The server's view of the step on screen: which slot, and what phones should show. */
function desired() {
  const s = step();
  switch (S.phase) {
    case "lobby": return { slot: STEPS[0].id, phase: "idle" };
    case "arrive": return { slot: s.id, phase: "arrive" };
    case "ask": return { slot: s.id, phase: S.closed[s.id] ? "closed" : "open" };
    case "locked": return { slot: s.id, phase: "closed" };
    case "reveal": return { slot: s.id, phase: "reveal" };
  }
  return { slot: s.id, phase: "show" }; // intro, showcase (first state), reveal / persona / info cards, closing
}
let seqN = 0;
function syncServer(override) {
  const want = { ...(override || desired()), seq: Date.now() * 1000 + (seqN++ % 1000) };
  // The voting countdown goes with the step, so phones can show it too
  const v = voteView();
  const vote = !override && S.phase === "ask" && v.slot === slotOf() ? { remainingMs: v.remainingMs, duration: v.duration, paused: v.paused, locked: v.locked } : null;
  live.chain = live.chain.then(async () => {
    if (!live.on) return;
    try {
      const r = await adminCall({ action: "set", slot: want.slot, phase: want.phase, seq: want.seq, vote });
      if (r.status === 401) return fallbackToHost("The server didn't accept the PIN. Staying in Host mode (press L).");
      if (!r.ok) throw new Error(r.status);
      live.lastOk = Date.now();
      applyServerState(r.data.state);
    } catch {
      setTimeout(() => live.on && syncServer(), 1500); // the watchdog handles a server that stays away
    }
  });
}

// ------------------------------------------------------------------ input
function act(name) {
  switch (name) {
    case "next": return next();
    case "back": return back();
    case "closeVote": return toggleVote();
    case "word": return addWord(0);
    case "wordNever": return addWord(1);
    case "timer": return setTimer(timerRunning() ? "stop" : "start");
    case "reset": return resetGame();
    case "mode": return live.on ? fallbackToHost("Host mode: enter the room's answers with the keyboard.") : enableLive(false);
    case "returnLive": return enableLive(false);
  }
}
/** One key (from the keyboard, a clicker, or the moderator's keypad). Returns true if it did something. */
function handleKey(k) {
  const map = { ArrowRight: "next", " ": "next", PageDown: "next", Enter: "next", ArrowLeft: "back", PageUp: "back", Backspace: "back", v: "closeVote", V: "closeVote", t: "timer", T: "timer", l: "mode", L: "mode", w: "word", W: "word", n: "wordNever", N: "wordNever" };
  if (k === "p" || k === "P") return pauseVote(), true;
  if (k === "+" || k === "=") return extendVote(15), true;
  if (k === "m" || k === "M") return toggleMute(), true;
  if (/^[1-9]$/.test(k)) return enter(Number(k) - 1), true;
  if (k === "0") return enter(-1), true;
  if (/^[a-dA-D]$/.test(k)) return enter(k.toUpperCase().charCodeAt(0) - 65), true;
  if (map[k]) return act(map[k]), true;
  return false;
}
addEventListener("keydown", (e) => {
  if (modalOpen || e.ctrlKey || e.metaKey || e.altKey || !S) return;
  const k = e.key;
  if (k === "f" || k === "F") return e.preventDefault(), document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.().catch(() => {});
  if (k === "h" || k === "H") return e.preventDefault(), document.body.classList.toggle("badge-hidden");
  if (handleKey(k)) e.preventDefault();
});

window.__ride = { get state() { return S; }, get live() { return live; }, get steps() { return STEPS; }, stats, screenId: () => screenId(), fuel: () => fuel(), nextLabel: () => nextLabel(C, STEPS, S.i, S.phase), placeholders: () => placeholdersOf(step()) };
init();
