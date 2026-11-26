/* The Ride: projector — the one screen the presenter runs the whole session from.
 * The route is one ordered list of screens (route.js → buildScreens), one per story beat. The dock's main
 * button (or → / Space / a clicker) moves to the next screen. Rides and the ignition play by themselves.
 * Everything is saved in localStorage, so a reload resumes exactly.
 * Live is the default: the Worker relays votes from phones. If it is silent for 5 s, Host mode takes over.
 */
import { buildScreens, nextLabel, convoyAt, routeAt, stepOf, stopOf, placeOf, phaseOf, pumpSkip, placeholdersOf, filled, fmt, esc, km, isVoteStep } from "./route.js";
import { icon } from "./icons.js";
import { pill, personaIcon, stopPersona, bike, milestone, route, fuelGauge, optionCard, qr, clock } from "./ui.js";

const $ = (s) => document.querySelector(s);
const STORE = "ride.state.v6";
const PIN_KEY = "ride.pin";
const MUTE_KEY = "ride.muted";
const FIRE_MS = 2600;
const LOST_AFTER_MS = 5000;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let C, SCREENS, last, S;
let busy = false;
let prevI = null; // the screen rendered last (to animate only forward, one step at a time)
const live = { on: false, ws: null, wsOpen: false, pollTimer: null, pingTimer: null, reconnectTimer: null, chain: Promise.resolve(), lastOk: 0, lost: false, canReturn: false, riders: 0, lastCmd: 0, hostOnly: false };
const openedAt = {};
let lastToast = { text: "", at: 0 };

const fresh = () => ({ i: 0, closed: {}, final: {}, tallies: {}, manual: {}, vote: { slot: null }, think: { key: null }, round: null });
const U = (k, v) => fmt(C.ui[k], v);
const cfg = (k, d) => C?.config?.[k] ?? d;
const scr = (i = S.i) => SCREENS[i];
const tallyOf = (slot) => S.tallies[slot] || { n: 0, counts: {} };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(h);
const voteUrl = () => (filled(cfg("publicUrl", "")) ? cfg("publicUrl", "").replace(/\/+$/, "") : location.origin) + "/v";
const shortUrl = () => voteUrl().replace(/^https?:\/\//, "");

function fit() {
  document.documentElement.style.setProperty("--scale", Math.min(innerWidth / 1440, innerHeight / 810));
}
addEventListener("resize", fit);
fit();

// ------------------------------------------------------------------ sound (generated; mute from the dock or M)
const sound = {
  ctx: null,
  idle: null,
  muted: (() => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } })(),
  wake() {
    if (!this.ctx) try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    if (this.ctx.state === "suspended") this.ctx.resume().then(() => syncSound()).catch(() => {});
  },
  ok() { return !this.muted && this.ctx && this.ctx.state === "running"; },
  tone(freq, dur, at = 0, gain = 0.05) {
    if (!this.ok()) return;
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
  tick() { this.tone(1046, 0.06, 0, 0.03); },
  lock() { this.tone(523, 0.12, 0, 0.05); this.tone(392, 0.16, 0.09, 0.045); },
  reveal() { this.tone(659, 0.14, 0, 0.05); this.tone(988, 0.26, 0.12, 0.05); },
  /** A soft engine idle: two low saws through a low-pass filter, with a slow throb. */
  startIdle() {
    if (this.idle || !this.ok()) return;
    const c = this.ctx;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, c.currentTime);
    out.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 1.5);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    const throb = c.createGain();
    throb.gain.value = 0.7;
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 9;
    lfoG.gain.value = 0.3;
    lfo.connect(lfoG).connect(throb.gain);
    const oscs = [38, 57].map((f) => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      return o;
    });
    lp.connect(throb).connect(out).connect(c.destination);
    [...oscs, lfo].forEach((o) => o.start());
    this.idle = { out, oscs: [...oscs, lfo] };
  },
  stopIdle() {
    if (!this.idle) return;
    const { out, oscs } = this.idle;
    this.idle = null;
    try {
      const t = this.ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      oscs.forEach((o) => o.stop(t + 0.9));
    } catch {}
  },
  /** The roar on "Fire it up": a rising saw, a burst, then settling into the ride. */
  roar() {
    if (!this.ok()) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    o.type = o2.type = "sawtooth";
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    const g = c.createGain();
    o.frequency.setValueAtTime(45, t);
    o.frequency.exponentialRampToValueAtTime(190, t + 1.1);
    o.frequency.exponentialRampToValueAtTime(120, t + 2.2);
    o2.frequency.setValueAtTime(68, t);
    o2.frequency.exponentialRampToValueAtTime(280, t + 1.1);
    o2.frequency.exponentialRampToValueAtTime(180, t + 2.2);
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(1300, t + 1.1);
    lp.frequency.exponentialRampToValueAtTime(500, t + 2.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.25);
    g.gain.setValueAtTime(0.12, t + 1.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(c.destination);
    o.start(t); o2.start(t);
    o.stop(t + 2.7); o2.stop(t + 2.7);
  },
};
addEventListener("keydown", () => sound.wake(), { capture: true });
addEventListener("pointerdown", () => sound.wake(), { capture: true });
/** The engine idles under the cold open and the title card only. */
function syncSound() {
  if (!S) return;
  const b = scr().beat;
  if ((b === "cold" || b === "title") && sound.ok()) sound.startIdle();
  else sound.stopIdle();
  announce();
}
function toggleMute() {
  sound.muted = !sound.muted;
  try { localStorage.setItem(MUTE_KEY, sound.muted ? "1" : "0"); } catch {}
  if (sound.muted) sound.stopIdle();
  syncSound();
  toast(sound.muted ? "Sound off" : "Sound on");
}

// ------------------------------------------------------------------ fuel = participation (quiet, never lost)
function fuel() {
  let f = cfg("fuelStart", 50);
  for (const s of SCREENS) {
    if (s.beat !== "locked") continue;
    const fin = S.final[s.slot];
    if (fin) f += fin.ratio * (stepOf(C, s)?.type === "pump" ? cfg("fuelPerPump", 20) : cfg("fuelPerVote", 10));
  }
  return Math.round(Math.min(100, f));
}
function lowTurnout() {
  const s = scr();
  if (!live.on || !live.riders || !["vote", "locked"].includes(s.beat)) return false;
  const fin = S.final[s.slot];
  if (fin) return fin.ratio < cfg("lowTurnout", 0.3);
  const at = openedAt[s.slot];
  return !!at && Date.now() - at > 10000 && tallyOf(s.slot).n / live.riders < cfg("lowTurnout", 0.3);
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
    $("#main").innerHTML = `<div class="layer"><div class="card state-msg"><h1 class="headline-lg">The ride can't start yet</h1><p class="body-lg">The story didn't load. Check the connection to the server, then reload this page.</p></div></div>`;
    return;
  }
  SCREENS = buildScreens(C);
  last = SCREENS.length - 1;
  try { await Promise.all(["700 56px Playfair", "600 36px Playfair", "400 15px Poppins", "600 14px Poppins", "500 14px 'Red Hat Mono'"].map((f) => document.fonts.load(f))); } catch {}
  S = loadState();
  // A reload in the middle of a ride or the ignition lands where it was heading
  if (scr().transient) S.i = Math.min(last, S.i + 1);
  // A reload on THINK waits for the presenter instead of opening voting at once
  if (scr().beat === "think") S.think = { key: scr().key, done: true, duration: cfg("thinkSeconds", 15) };
  render();
  setInterval(tick, 250);
  if (wantLive()) enableLive(true);
  setInterval(watchdog, 1000);
  announce();
}
const wantLive = () => new URLSearchParams(location.search).get("mode") !== "host" && location.protocol.startsWith("http");

// ------------------------------------------------------------------ results
function roomTop(step) {
  const t = tallyOf(step.id);
  const m = S.manual[step.id] || {};
  const ids = step.options.map((o) => o.id);
  if (step.format === "pickn") {
    if (m.picks?.length) return m.picks;
    if (!t.n) return [];
    return [...ids].sort((a, b) => (t.counts[b] || 0) - (t.counts[a] || 0) || ids.indexOf(a) - ids.indexOf(b)).slice(0, step.n);
  }
  if (m.choice) return [m.choice];
  const max = Math.max(0, ...ids.map((id) => t.counts[id] || 0));
  return max ? [ids.find((id) => (t.counts[id] || 0) === max)] : [];
}

// ------------------------------------------------------------------ render (Stitch projector: HUD, stage card, road)
const PROLOGUE = ["cold", "title", "crew", "fact", "crewClose", "ignite", "fired"];
const AFTER = ["reveal", "handover", "card", "closing"]; // the room's answer is known: highlight it
let cardKey = "";
let bgKey = "";
let hudHTML = "";

function render() {
  const s = scr();
  const forward = prevI != null && S.i === prevI + 1;
  const stop = stopOf(C, s);
  const st = $("#stage");
  document.body.dataset.beat = s.beat;
  st.dataset.beat = s.beat;
  st.dataset.p = s.beat === "lobby" || PROLOGUE.includes(s.beat) || s.beat === "ride" ? "crew" : stopPersona(stop);
  st.classList.toggle("live", live.on);
  st.classList.toggle("riding", s.beat === "ride" || s.beat === "fired");
  renderBackdrop(s, stop);
  renderHud(s, stop);
  renderCard(s, stop, forward);
  renderRoad(s, stop, forward);
  updateResults();
  updateTimers();
  updatePlayers();
  syncSound();
  prevI = S.i;
  announce();
}

/** Cross-fade: the old layer fades out while the new one fades in. */
function swap(box, html) {
  for (const old of [...box.children]) {
    if (old.classList.contains("leaving")) continue;
    old.classList.add("leaving");
    setTimeout(() => old.remove(), 600);
  }
  const el = document.createElement("div");
  el.className = "layer entering";
  el.innerHTML = html;
  box.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("entering")));
  return el;
}
const current = () => $("#main").lastElementChild;

// ------------------------------------------------------------------ backdrop: the place's illustration behind a dark scrim
function sceneOf(s, stop) {
  if (s.beat === "lobby") return "workbench";
  if (PROLOGUE.includes(s.beat)) return "prologue"; // Bengaluru's edge at dusk, before the convoy sets off
  if (s.beat === "ride") {
    // One panorama per leg, by the next place on the route (the pump sits on the leg to Nagpur)
    const next = C.stops.slice(s.stop).find((x) => placeOf(C, x));
    return `road-${Math.max(1, C.places.indexOf(placeOf(C, next)))}`;
  }
  return stop?.scene || "prologue";
}
function renderBackdrop(s, stop) {
  const k = sceneOf(s, stop);
  if (k === bgKey) return;
  bgKey = k;
  const src = cfg("backdrops", {})[k];
  const el = swap($("#backdrop"), `<i class="scrim"></i>`);
  el.dataset.scene = k;
  if (src) loadBackdrop(el, src, 0);
}

/** A scene's illustration, saved as .webp, .jpg or .png (whichever exists). Road panoramas tile sideways. */
const BACKDROP_TYPES = ["webp", "jpg", "png"];
function loadBackdrop(layer, base, k) {
  if (k >= BACKDROP_TYPES.length || !layer.isConnected) return;
  const img = new Image();
  img.alt = "";
  img.onload = () => {
    if (!layer.dataset.scene.startsWith("road-")) return layer.prepend(img);
    const pano = document.createElement("div");
    pano.className = "pano";
    pano.style.backgroundImage = `url("${img.src}")`;
    layer.prepend(pano);
  };
  img.onerror = () => loadBackdrop(layer, base, k + 1);
  img.src = `${base}.${BACKDROP_TYPES[k]}`;
}

// ------------------------------------------------------------------ HUD: where we are (left); players or Host mode, and the join QR (right)
function chapterText(s, stop) {
  if (PROLOGUE.includes(s.beat)) return U("prologue", { from: C.coldOpen.from, to: C.coldOpen.to, km: km(C.places[C.places.length - 1].km) });
  const place = (st) => placeOf(C, st);
  if (s.beat === "ride" || stop?.type === "pump") {
    const p = place(C.stops.slice(s.stop).find((x) => place(x)));
    return p ? U("towards", { place: p.name, km: km(p.km) }) : U("onTheRoad");
  }
  const p = place(stop);
  return p ? U("chapter", { n: C.places.indexOf(p) + 1, total: C.places.length, name: stop.chapter || stop.spot, theme: stop.theme || "" }) : "";
}
const hostChip = () => `<span class="chip host"><i class="dot"></i><span class="label-lg">${esc(U("hostMode"))}</span></span>`;
const playersChip = () => `<span class="chip"><i class="dot"></i><span class="label-lg muted">${esc(U("onBoard"))}</span><b class="mono-md" id="playersN">0</b></span>`;
function joinChip() {
  return `<span class="chip join"><span class="qr-mini" data-qr="${esc(voteUrl())}"></span><span class="join-t"><b class="label-sm">${esc(C.lobby.title)}</b><span class="mono-md">${esc(shortUrl())}</span></span></span>`;
}
/** The vote panel shows its own QR code; everywhere else (live) a small one sits in the HUD. */
const panelQR = (s, stop) => s.beat === "vote" && !S.closed[s.slot] && sideLayout(ctxOf(s, stop), stop);

function renderHud(s, stop) {
  const right = s.beat === "lobby" && live.on
    ? `<span class="chip big"><i class="dot"></i><span class="label-lg muted">${esc(U("playersOnBoard"))}</span><b class="mono-lg" id="playersN">0</b></span>`
    : `${live.on ? playersChip() : hostChip()}${live.on && s.beat !== "lobby" && !panelQR(s, stop) ? joinChip() : ""}`;
  const left = s.beat === "lobby" ? `<div class="hud-l row">${pill(C, "crew", U("brand"))}</div>` : `<div class="hud-l"><span class="mono-md caps chapter">${esc(chapterText(s, stop))}</span></div>`;
  const html = `${left}<div class="hud-r">${right}</div>`;
  if (html === hudHTML) return;
  hudHTML = html;
  const h = $("#hud");
  h.className = s.beat === "lobby" ? "lobby" : "";
  h.innerHTML = html;
  h.querySelectorAll("[data-qr]").forEach((q) => (q.innerHTML = qr(q.dataset.qr)));
  setCount($("#playersN"), live.riders, true);
}
function updatePlayers() {
  setCount($("#playersN"), live.riders);
}
function setCount(el, n, instant) {
  if (!el) return;
  const target = Math.max(0, n | 0);
  el.dataset.target = target;
  if (instant || el.dataset.shown == null || reduceMotion()) {
    el.dataset.shown = target;
    el.textContent = target;
    return;
  }
  if (el.dataset.ticking) return;
  const step = () => {
    const cur = Number(el.dataset.shown);
    const tgt = Number(el.dataset.target);
    if (cur === tgt || !el.isConnected) return delete el.dataset.ticking;
    const nx = cur + Math.sign(tgt - cur) * Math.max(1, Math.ceil(Math.abs(tgt - cur) / 8));
    el.dataset.shown = nx;
    el.textContent = nx;
    el.dataset.ticking = "1";
    setTimeout(step, 60);
  };
  step();
}

// ------------------------------------------------------------------ the stage card
/** The question a stop screen is about: the one being asked, or the last one answered (cards, handover). */
function ctxOf(s, stop) {
  if (!stop) return null;
  const votes = stop.steps.filter(isVoteStep);
  if (s.beat === "look" || (s.beat === "listen" && stop.steps.some((x) => x.sites))) return null;
  if (s.beat === "listen" || s.beat === "gather") return votes[0] || null;
  if (s.beat === "handover") return votes[votes.length - 1] || null;
  const step = stepOf(C, s);
  if (!step) return null;
  if (isVoteStep(step)) return step;
  const k = stop.steps.indexOf(step);
  return [...stop.steps.slice(0, k)].reverse().find(isVoteStep) || null;
}
/** Four (or three) answers sit beside a side panel; nine answers and the travellers take the full width. */
const sideLayout = (step, stop) => !!step && !stop?.steps.some((x) => x.sites) && !["pickn", "badges"].includes(step.format);

function cardKeyOf(s, stop) {
  if (s.beat === "lobby") return `lobby|${live.on}`;
  if (PROLOGUE.includes(s.beat)) return "prologue";
  if (s.beat === "arrive" || s.beat === "ride") return s.key;
  const ctx = ctxOf(s, stop);
  return `${stop.id}|${ctx?.id || "look"}|${live.on && navigator.onLine}`;
}

function renderCard(s, stop, forward) {
  const key = cardKeyOf(s, stop);
  const main = $("#main");
  main.dataset.layout = s.beat === "lobby" ? "lobby" : "card";
  if (key !== cardKey) {
    cardKey = key;
    const el = swap(main, cardHTML(s, stop));
    el.querySelectorAll("[data-qr]").forEach((q) => (q.innerHTML = qr(q.dataset.qr)));
    requestAnimationFrame(() => {
      sizeFrames(el);
      fitCard(el);
    });
    el.querySelectorAll("img").forEach((im) => im.addEventListener("load", () => fitCard(el), { once: true }));
  }
  const root = current();
  if (!root) return;
  root.dataset.beat = s.beat;
  if (PROLOGUE.includes(s.beat)) patchPrologue(root, s);
  else if (stop && !["arrive", "ride"].includes(s.beat)) patchStop(root, s, stop);
  if (s.beat === "ride" && forward) rideCounter(root, s);
  fitCard(root);
}

/** Keep the card inside the stage: scale it down a little if a long answer would push it over. */
function fitCard(root) {
  const card = root?.querySelector(".card");
  if (!card) return;
  card.style.transform = "";
  const m = getComputedStyle($("#main"));
  const room = $("#main").clientHeight - parseFloat(m.paddingTop) - parseFloat(m.paddingBottom);
  const h = card.offsetHeight;
  if (h > room) card.style.transform = `scale(${Math.max(0.78, room / h).toFixed(3)})`;
}

function cardHTML(s, stop) {
  if (s.beat === "lobby") return lobbyHTML();
  if (PROLOGUE.includes(s.beat)) return prologueHTML();
  if (s.beat === "ride") return rideHTML(s, stop);
  if (s.beat === "arrive") return arriveHTML(stop);
  if (stop.steps.some((x) => x.sites)) return sitesCardHTML(s, stop);
  if (stop.gathering) return palaceHTML(s, stop);
  return stopCardHTML(s, stop);
}

function lobbyHTML() {
  const L = C.lobby;
  const left = `<div class="lobby-l"><h1 class="display-lg balance">${esc(live.on ? L.title : C.title)}</h1><p class="headline-md muted pretty">${esc(live.on ? L.line : L.hostLine)}</p></div>`;
  const right = live.on
    ? `<article class="qr-card"><div class="qr-big" data-qr="${esc(voteUrl())}"></div><span class="mono-lg">${esc(shortUrl())}</span></article>`
    : `<article class="qr-card hands">${icon("front_hand")}</article>`;
  return `<div class="lobby">${left}${right}</div>`;
}

// The prologue: one quiet card for the cold open, the title, who's riding and the ignition (patched per beat)
function prologueHTML() {
  return `<div class="card prologue">
    <h1 class="display-lg balance" data-title></h1>
    <p class="headline-md pretty" data-line></p>
    <ul class="facts">${C.crew.facts.map((f, k) => (filled(f) ? `<li class="tile fact" data-k="${k}">${icon("check_circle", "pcb")}<span class="body-md">${esc(f)}</span></li>` : "")).join("")}</ul>
    <span class="meter rev"><i data-rev></i></span>
  </div>`;
}
function patchPrologue(root, s) {
  const CO = C.coldOpen;
  let title = "", line = "";
  if (s.beat === "cold") line = CO.lines[s.line];
  if (s.beat === "title") [title, line] = [CO.title, `${CO.from} → ${CO.to}`];
  if (["crew", "fact"].includes(s.beat)) [title, line] = [C.crew.title, C.crew.line];
  if (s.beat === "crewClose") line = C.crew.closing;
  if (s.beat === "ignite" || s.beat === "fired") line = C.ignition.prompt;
  root.querySelector("[data-title]").textContent = title;
  root.querySelector("[data-line]").textContent = line;
  const crew = ["crew", "fact"].includes(s.beat);
  root.querySelector(".facts").classList.toggle("hidden", !crew || !root.querySelector(".fact"));
  root.querySelectorAll(".fact").forEach((f) => f.classList.toggle("on", s.beat === "fact" && Number(f.dataset.k) <= s.fact));
}

function arriveHTML(stop) {
  const p = placeOf(C, stop);
  return `<div class="card arrive" data-p="${stopPersona(stop)}">
    <h1 class="display-lg balance">${esc(p ? p.name : stop.spot)}</h1>
    <p class="headline-md muted">${esc(stop.arrival ? U("fullConvoy") : stop.spot)}</p>
  </div>`;
}

function rideHTML(s, stop) {
  const dest = placeOf(C, stop);
  const prev = [...C.stops.slice(0, s.stop)].reverse().find((x) => placeOf(C, x));
  const from = placeOf(C, prev)?.km ?? 0;
  return `<div class="card ride">
    <span class="mono-md caps pcb">${esc(U("onTheRoad"))}</span>
    <h1 class="display-md">${esc(dest ? dest.name : stop.spot)}</h1>
    ${dest ? `<span class="mono-lg" data-km data-from="${from}" data-to="${dest.km}">${esc(km(dest.km))}</span>` : `<span class="mono-lg">${icon("local_gas_station", "saffron")}</span>`}
  </div>`;
}
/** The odometer on the ride card counts up to the next stop's km while the bikes ride. */
function rideCounter(root) {
  const el = root.querySelector("[data-km]");
  if (!el || reduceMotion()) return;
  const a = Number(el.dataset.from);
  const b = Number(el.dataset.to);
  const dur = cfg("rideMs", 3000) * 0.9;
  const t0 = performance.now();
  const step = (t) => {
    const f = Math.min(1, (t - t0) / dur);
    el.textContent = km(Math.round(a + (b - a) * (1 - (1 - f) ** 2)));
    if (f < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A stop's card: persona, story line, question, answers; and the vote panel or the stop's info card. */
function stopCardHTML(s, stop) {
  const ctx = ctxOf(s, stop);
  const pid = stopPersona(stop);
  const side = sideLayout(ctx, stop);
  const isPump = stop.type === "pump";
  const head = isPump ? `<span class="pill persona" data-p="lakshmi">${icon("local_gas_station")}<span class="label-lg">${esc(stop.spot)}</span></span>` : pill(C, pid);
  const n = ctx?.options.length || 0;
  return `<div class="card stop ${side ? "side" : "wide"}" data-p="${pid}">
    <div class="col-main">
      <div class="row">${head}<span class="spacer"></span><span class="status" data-status></span></div>
      <p class="story body-lg pretty" data-story></p>
      <h1 class="headline-lg balance" data-head></h1>
      ${ctx ? `<div class="opts n${n}">${ctx.options.map((o, k) => optionCard(C, ctx, o, k)).join("")}</div>` : ""}
      <p class="after body-md pretty" data-after></p>
    </div>
    ${side ? `<aside class="panel" data-panel></aside>` : ""}
  </div>`;
}

/** One line per beat: the voice while listening, the twist once the answer is known. */
function storyOf(s, stop, ctx) {
  if (s.beat === "listen" || s.beat === "look") return stop.voice ? { text: `“${stop.voice}”` } : null;
  const twist = !stop.steps.some((x) => x.sites) && ctx?.revealNote; // Stop 1 puts its reveal beside the question
  if (["reveal", "card"].includes(s.beat) && twist) return { text: twist, twist: true };
  return null;
}
function patchStop(root, s, stop) {
  const ctx = ctxOf(s, stop);
  const step = stepOf(C, s);
  const story = root.querySelector("[data-story]");
  if (story) {
    const st = storyOf(s, stop, ctx);
    story.classList.toggle("solo", s.beat === "listen");
    story.classList.toggle("twist", !!st?.twist);
    story.textContent = st ? st.text : "";
  }
  const head = root.querySelector("[data-head]");
  const twisted = story && story.classList.contains("twist") && s.beat === "reveal";
  if (head) head.textContent = twisted ? "" : s.beat === "handover" ? `“${stop.handover}”` : s.beat === "closing" ? step.text : ["listen", "gather", "look"].includes(s.beat) || !ctx ? "" : ctx.question;
  const after = root.querySelector("[data-after]");
  if (after) {
    let t = "";
    if (stop.type === "pump" && ["locked"].includes(s.beat)) t = ctx.resultLine;
    if (stop.steps.some((x) => x.sites) && s.beat === "reveal") t = ctx.revealNote;
    after.textContent = t;
  }
  const stat = root.querySelector("[data-status]");
  if (stat) stat.innerHTML = statusHTML(s, stop, ctx);
  const panel = root.querySelector("[data-panel]");
  if (panel) {
    const html = panelHTML(s, stop, ctx, step);
    if (panel.dataset.html !== html) {
      panel.dataset.html = html;
      panel.innerHTML = html;
      panel.querySelectorAll("[data-qr]").forEach((q) => (q.innerHTML = qr(q.dataset.qr)));
      panel.classList.toggle("empty", !html);
      if (step?.rows) playTokens(panel);
    }
  }
  const sites = root.querySelector(".sites");
  if (sites) sites.classList.toggle("flipped", ctx?.revealSites && ["reveal", "handover"].includes(s.beat));
  const guessed = root.querySelector("[data-guessed]");
  if (guessed) guessed.innerHTML = ctx?.revealSites && ["reveal", "handover"].includes(s.beat) ? guessHTML(stop) : "";
}

/** Compact vote status (Stop 1, nine answers, the travellers): label, clock, answers in. */
function statusHTML(s, stop, ctx) {
  if (!ctx || sideLayout(ctx, stop)) return "";
  if (s.beat === "think") return `<span class="label-lg pcb">${esc(U("thinkLabel"))}</span><span class="mono-lg pcb" data-clock></span>`;
  if (s.beat === "vote" && !S.closed[s.slot]) return `<span class="label-lg pcb"><i class="dot pulse"></i>${esc(U("votingOpen"))}</span><span class="mono-lg pcb" data-clock></span>${live.on ? `<span class="mono-md muted" data-voted></span>` : ""}`;
  if (s.beat === "vote" || s.beat === "locked") return `<span class="label-lg muted">${icon("lock")} ${esc(U("votesLocked"))}</span>${live.on ? `<span class="mono-md muted" data-voted></span>` : ""}`;
  return "";
}

/** The side panel: think timer, vote (QR + clock + count, or show of hands), votes locked, or the stop's info card. */
function panelHTML(s, stop, ctx, step) {
  if (s.beat === "card" && step) return infoCardHTML(step);
  if (s.beat === "think")
    return `<div class="panel-box"><div class="ph"><span class="label-lg pcb">${esc(U("thinkLabel"))}</span><span class="mono-lg" data-clock></span></div><span class="meter"><i data-meter></i></span></div>`;
  if (s.beat === "vote" && !S.closed[s.slot]) {
    const head = `<div class="ph"><span class="label-lg pcb"><i class="dot pulse"></i>${esc(U("votingOpen"))}</span><span class="mono-lg" data-clock></span></div>`;
    if (!live.on) return `<div class="panel-box">${head}<div class="hands">${icon("front_hand", "pcb")}<span class="title-md">${esc(U("showOfHands"))}</span></div><span class="meter"><i data-meter></i></span></div>`;
    return `<div class="panel-box">${head}<div class="qr-box" data-qr="${esc(voteUrl())}"></div><span class="mono-md" data-voted></span></div>`;
  }
  if (s.beat === "vote" || s.beat === "locked")
    return `<div class="panel-box"><div class="ph"><span class="label-lg muted">${icon("lock")} ${esc(U("votesLocked"))}</span><span class="mono-lg muted">00:00</span></div>${live.on ? `<span class="mono-md" data-voted></span>` : ""}</div>`;
  return "";
}

/** Stop 3's cards: the token swap and Insight Out (its QR code only once the link is filled in). */
function infoCardHTML(step) {
  if (step.rows)
    return `<div class="info-card" data-p="arif"><span class="label-lg pcb">${esc(step.title)}</span>
      <div class="tokens mono-md">${step.rows.map((r, k) => `<div class="tok" style="--k:${k}"><span class="from muted">${esc(r.from)}</span><span class="to pcb">→ ${esc(r.to)}</span></div>`).join("")}</div>
      <p class="body-md muted pretty">${esc(step.text)}</p></div>`;
  return `<div class="info-card" data-p="crew"><span class="label-lg pcb">${esc(step.title)}</span><p class="body-md muted pretty">${esc(step.text)}</p>
    ${filled(step.link) ? `<div class="link-row"><div class="qr-box small" data-qr="${esc(step.link)}"></div><span class="mono-md">${esc(step.link.replace(/^https?:\/\//, ""))}</span></div>` : ""}</div>`;
}
/** The token rows swap one after another (names turn into tokens). */
function playTokens(panel) {
  const card = panel.querySelector(".info-card");
  if (!card || reduceMotion()) return card?.classList.add("swapped");
  setTimeout(() => card.classList.add("swapped"), 400);
}

// Stop 1: the two websites (live embed when online and Live, else the bundled screenshot), flipping on the reveal
function sitesCardHTML(s, stop) {
  const ctx = ctxOf(s, stop);
  const look = !ctx;
  const sites = stop.steps.find((x) => x.sites).sites;
  const embed = live.on && navigator.onLine;
  const cards = sites
    .map((site) => {
      const facts = [["builtBy", site.builtBy], ["took", site.took], ["cost", site.cost]].filter(([, v]) => filled(v));
      const host = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const shot = embed && site.embed
        ? `<div class="frame"><iframe src="${esc(site.url)}" title="${esc(site.title)}" loading="lazy" tabindex="-1" sandbox="allow-scripts allow-same-origin"></iframe></div>`
        : `<div class="frame"><img src="${esc(site.image)}" alt="${esc(`The ${site.title} website`)}" /></div>`;
      return `<article class="site" data-p="${esc(site.tone || "crew")}"><div class="site-in">
        <div class="face front"><div class="row between"><span class="title-md">${esc(site.title)}</span>${icon(site.icon || "link", "pcb")}</div>
          <div class="shot">${shot}<div class="row between"><span class="label-sm">${esc(site.caption || "")}</span><span class="mono-md pcb">${esc(host.split("/")[0].split(".").slice(-2).join("."))}</span></div></div></div>
        <div class="face back"><div class="row between"><span class="title-md">${esc(site.title)}</span>${icon(site.icon || "link", "pcb")}</div>
          <div class="back-in">${facts.length ? `<dl>${facts.map(([k, v]) => `<div><dt class="label-sm pcb">${esc(U(k))}</dt><dd class="body-md">${esc(v)}</dd></div>`).join("")}</dl>` : `${icon(site.icon || "link", "big pcb")}<span class="label-sm pcb">${esc(site.caption || "")}</span>`}<span class="mono-md">${esc(host)}</span></div></div>
      </div></article>`;
    })
    .join("");
  const crew = `<div class="row">${pill(C, "crew", C.personas.crew.name)}</div>`;
  if (look)
    return `<div class="card stop sites-look" data-p="crew"><div class="col-main">${crew}<p class="story body-lg pretty" data-story></p><div class="sites big">${cards}</div></div></div>`;
  return `<div class="card stop sites-q" data-p="crew">
    <div class="col-main">${crew}<p class="story body-md pretty" data-story></p><div class="sites">${cards}</div><p class="guessed body-md" data-guessed></p></div>
    <div class="col-q"><div class="row between"><span></span><span class="status" data-status></span></div>
      <h1 class="headline-lg balance" data-head></h1>
      <div class="opts n${ctx.options.length}">${ctx.options.map((o, k) => optionCard(C, ctx, o, k)).join("")}</div>
      <p class="after body-md pretty pcb" data-after></p></div>
  </div>`;
}
function guessHTML(stop) {
  const guess = stop.steps.find((x) => x.type === "guess");
  const top = guess && roomTop(guess)[0];
  if (!top) return "";
  const t = tallyOf(guess.id);
  return `<span class="label-sm muted">${esc(U("roomGuessed"))}</span> <b>${esc(guess.options.find((x) => x.id === top).text)}</b>${t.n ? ` <span class="mono-md pcb">${pct(t.counts[top] || 0, t.n)}%</span>` : ""}`;
}
/** Live sites are drawn at desktop size and scaled into their frame. */
function sizeFrames(root) {
  root.querySelectorAll(".frame iframe").forEach((f) => {
    const box = f.parentElement;
    const k = box.clientWidth / 1280;
    f.style.transform = `scale(${k})`;
    f.style.height = `${box.clientHeight / k}px`;
  });
}

// The palace: the four travellers, Q7 on their cards, and the closing line
function palaceHTML(s, stop) {
  const ctx = ctxOf(s, stop);
  const lines = Object.fromEntries(stop.gathering.map((g) => [g.persona, g.line]));
  return `<div class="card stop palace" data-p="crew">
    <div class="col-main">
      <div class="row between"><span></span><span class="status" data-status></span></div>
      <h1 class="headline-lg balance" data-head></h1>
      <div class="opts n4 travellers">${ctx.options.map((o, k) => optionCard(C, ctx, o, k, lines)).join("")}</div>
      <p class="after body-lg pretty" data-after></p>
    </div></div>`;
}

// ------------------------------------------------------------------ results on the answers
function updateResults() {
  const s = scr();
  const stop = stopOf(C, s);
  const step = ctxOf(s, stop);
  const root = current();
  if (!root) return;
  if (step && isVoteStep(step)) {
    const t = tallyOf(step.id);
    const m = S.manual[step.id] || {};
    const top = AFTER.includes(s.beat) ? roomTop(step) : [];
    const pre = ["listen", "gather", "think"].includes(s.beat);
    root.querySelectorAll(".opt").forEach((el) => {
      const id = el.dataset.o;
      let p = pct(t.counts[id] || 0, t.n);
      let txt = t.n ? `${p}%` : "";
      if (!t.n && (m.choice || m.picks)) {
        p = m.choice === id || m.picks?.includes(id) ? 100 : 0; // Host mode: the room's pick, entered by hand
        txt = "";
      }
      el.style.setProperty("--p", `${pre ? 0 : p}%`);
      el.querySelector(".pct").textContent = pre ? "" : txt;
      el.classList.toggle("top", top.includes(id));
      el.classList.toggle("picked", !pre && !t.n && p === 100);
    });
    root.querySelectorAll("[data-voted]").forEach((v) => (v.textContent = U("voted", { n: t.n, total: live.riders })));
  }
  const g = root.querySelector("[data-guessed]");
  if (g && g.innerHTML) g.innerHTML = guessHTML(stop);
  if (s.beat !== "lobby") {
    const f = $("#fuel");
    const val = fuel();
    if (f.dataset.v !== String(val)) {
      f.dataset.v = val;
      f.innerHTML = fuelGauge(C, val);
    }
  }
}

// ------------------------------------------------------------------ the road: convoy, milestone, route and fuel
const SLOT = 200;
const LEFT = 48;
let roadKey = "";

/** The stop's persona waits by the road from their arrival until they join at the handover. */
function waitingAt(s, stop, joined) {
  const pid = stop?.persona;
  if (!pid || pid === "crew" || joined.includes(pid)) return null;
  return ["arrive", "listen", "think", "vote", "locked", "reveal", "card"].includes(s.beat) ? pid : null;
}
function rider(pid) {
  const el = document.createElement("div");
  el.className = "rider";
  el.dataset.p = pid;
  el.innerHTML = `<span class="tag label-sm">${icon(personaIcon(C, pid))}<span></span></span>${bike(pid, { beam: pid === "crew" })}`;
  return el;
}
function renderRoad(s, stop, forward) {
  const convoy = $("#convoy");
  const joined = convoyAt(C, SCREENS, S.i);
  const waiting = waitingAt(s, stop, joined);
  const n = joined.length + (waiting ? 1 : 0);
  const leadX = LEFT + n * SLOT;
  const want = ["crew", ...joined, ...(waiting ? [waiting] : [])];
  convoy.querySelectorAll(".rider").forEach((el) => !want.includes(el.dataset.p) && el.remove());
  want.forEach((pid, k) => {
    let el = convoy.querySelector(`.rider[data-p="${pid}"]`);
    const fresh = !el;
    if (fresh) {
      el = rider(pid);
      if (pid === waiting) el.classList.add("waiting");
      convoy.appendChild(el);
    }
    const x = pid === "crew" ? leadX : leadX - k * SLOT;
    el.classList.toggle("lead", pid === "crew");
    if (fresh) {
      el.style.transition = "none";
      el.style.setProperty("--x", `${x}px`);
      void el.offsetWidth;
      el.style.transition = "";
    } else el.style.setProperty("--x", `${x}px`);
    const joining = el.classList.contains("waiting") && pid !== waiting;
    el.classList.toggle("waiting", pid === waiting);
    if (joining && forward && !reduceMotion()) {
      el.classList.remove("joined");
      void el.offsetWidth;
      el.classList.add("joined");
    }
    const name = pid === "crew" ? U("brand") : C.personas[pid].name;
    el.querySelector(".tag > span").textContent = name;
  });
  // The palace: the full convoy rolls in together
  if (s.beat === "arrive" && stop?.arrival && forward && !reduceMotion()) {
    convoy.classList.remove("roll-in");
    void convoy.offsetWidth;
    convoy.classList.add("roll-in");
  }
  const lead = convoy.querySelector(".rider.lead");
  lead.classList.toggle("rev", s.beat === "fired");

  // The milestone: the stop's km and name in its colour (sliding in from the horizon on a ride)
  const sign = $("#sign");
  const signKey = s.beat === "lobby" || PROLOGUE.includes(s.beat) ? "start" : stop?.id || "";
  if (sign.dataset.k !== signKey) {
    sign.dataset.k = signKey;
    const p = s.beat === "lobby" || PROLOGUE.includes(s.beat) ? C.places[0] : placeOf(C, stop);
    const pid = signKey === "start" ? "lakshmi" : stopPersona(stop);
    const same = stop && C.stops.filter((x) => x.place === stop.place).indexOf(stop) > 0;
    sign.innerHTML = p ? milestone(pid, km(p.km), same ? stop.spot : p.name) : stop ? milestone("lakshmi", stop.sign || stop.spot, "", "local_gas_station") : "";
  }
  sign.classList.toggle("beside", s.beat === "lobby");
  sign.style.setProperty("--x", `${leadX + 192 + 24}px`);
  if (s.beat === "ride" && forward) {
    sign.classList.remove("arriving");
    void sign.offsetWidth;
    sign.style.animationDuration = `${cfg("rideMs", 3000)}ms`;
    sign.classList.add("arriving");
  } else if (s.beat !== "ride") sign.classList.remove("arriving");

  // Bottom HUD: route progress (and the lobby's tagline), fuel
  const cur = Math.max(0, routeAt(C, SCREENS, S.i));
  const personaAt = (p) => {
    if (stop && stop.place === p.id) return stopPersona(stop);
    return stopPersona(C.stops.find((x) => x.place === p.id && x.persona)) || "crew";
  };
  const rk = JSON.stringify([s.beat === "lobby", cur, s.beat === "ride", stop?.id]);
  if (rk !== roadKey) {
    roadKey = rk;
    $("#route").innerHTML = `<nav class="stops">${route(C, cur, { lobby: s.beat === "lobby", personaAt, riding: s.beat === "ride" })}</nav>`;
    $("#foot").classList.toggle("lobby", s.beat === "lobby");
  }
  $("#fuel").classList.toggle("hidden", s.beat === "lobby");
}

// ------------------------------------------------------------------ timers: THINK and VOTE clocks (mm:ss and a draining bar)
const voteView = () => {
  const v = S.vote;
  if (!v?.slot) return { slot: null, duration: 0, remainingMs: 0, paused: false, locked: false, running: false };
  const left = v.locked ? 0 : v.paused || !v.endsAt ? v.left : Math.max(0, v.endsAt - Date.now());
  return { slot: v.slot, duration: v.duration, remainingMs: left, paused: !!v.paused, locked: !!v.locked, running: !!v.endsAt && !v.paused && !v.locked };
};
const thinkView = () => {
  const t = S.think;
  if (!t?.key || t.key !== scr().key) return null;
  const left = t.done ? 0 : t.paused ? t.left : Math.max(0, t.endsAt - Date.now());
  return { remainingMs: left, duration: t.duration, paused: !!t.paused, done: !!t.done };
};
let lastTick = 0;
function showClock(root, ms, frac, paused) {
  root.querySelectorAll("[data-clock]").forEach((c) => {
    c.textContent = clock(ms);
    c.classList.toggle("paused", !!paused);
  });
  root.querySelectorAll("[data-meter]").forEach((m) => (m.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`));
}
function updateTimers() {
  const s = scr();
  const root = current();
  if (!root) return;
  if (s.beat === "think") {
    const tv = thinkView();
    showClock(root, tv?.remainingMs, tv && tv.duration ? tv.remainingMs / (tv.duration * 1000) : 0, tv?.paused);
    if (tv && !tv.done && !tv.paused && tv.remainingMs <= 0 && !busy) {
      S.think.done = true;
      return next(); // the think time ran out: the options appear
    }
  }
  if (s.beat === "vote") {
    const v = voteView();
    const on = v.slot === s.slot && !v.locked && !S.closed[s.slot];
    showClock(root, on ? v.remainingMs : 0, on && v.duration ? v.remainingMs / (v.duration * 1000) : 0, v.paused);
    if (on && live.on && !openedAt[s.slot]) openedAt[s.slot] = Date.now();
    if (on && v.running) {
      const sec = Math.ceil(v.remainingMs / 1000);
      if (sec <= 5 && sec >= 1 && sec !== lastTick) {
        lastTick = sec;
        sound.tick();
      }
      if (v.remainingMs <= 0 && !busy) return next(); // time's up: lock
    }
  }
}

function startVote(slot, seconds) {
  const d = seconds || cfg("voteSeconds", 30);
  S.vote = { slot, duration: d, endsAt: Date.now() + d * 1000, left: d * 1000, paused: false, locked: false };
  delete S.closed[slot];
  delete S.final[slot];
  lastTick = 0;
}
function lockVotes(slot) {
  const t = tallyOf(slot);
  S.vote = { ...S.vote, locked: true, endsAt: null, left: 0, paused: false };
  S.closed[slot] = true;
  // Host mode can't count phones: the room answers by show of hands, so it counts as everyone on board.
  const ratio = live.on ? (live.riders ? Math.min(1, t.n / live.riders) : 0) : 1;
  S.final[slot] = { n: t.n, riders: live.on ? live.riders : null, ratio };
  sound.lock();
}

// ------------------------------------------------------------------ flow
/** Move to screen t, running what entering it means (start a timer, lock votes, play a ride). */
function go(t) {
  if (t < 0 || t > last) return;
  const from = S.i;
  const s = SCREENS[t];
  S.i = t;
  const fwd = t > from;
  if (s.beat === "think") S.think = fwd ? { key: s.key, endsAt: Date.now() + cfg("thinkSeconds", 15) * 1000, duration: cfg("thinkSeconds", 15) } : { key: s.key, done: true, duration: cfg("thinkSeconds", 15) };
  if (s.beat === "vote") {
    if (fwd && S.vote.slot !== s.slot && !S.closed[s.slot]) startVote(s.slot);
    if (!fwd) delete S.final[s.slot]; // back from LOCK: the result comes off; votes stay closed until reopened
  }
  if (s.beat === "locked" && !S.final[s.slot]) lockVotes(s.slot);
  if (s.beat === "reveal") sound.reveal();
  if (s.beat === "fired") sound.roar();
  commit();
  if (s.transient) {
    busy = true;
    const ms = s.beat === "fired" ? FIRE_MS : cfg("rideMs", 3000);
    setTimeout(() => {
      busy = false;
      if (S.i === t) go(t + 1);
    }, reduceMotion() ? 300 : ms);
  }
}
function next() {
  if (busy || modalOpen) return;
  go(S.i + 1);
}
function back() {
  if (busy || modalOpen || S.i === 0) return;
  let t = S.i - 1;
  while (t > 0 && SCREENS[t].transient) t--;
  go(t);
}
function skip() {
  const t = pumpSkip(C, SCREENS, S.i);
  if (t != null && !busy) go(t);
}
/** Lock now (on VOTE), or reopen voting for 15 more seconds (on a closed VOTE or on LOCK). */
function toggleVote() {
  const s = scr();
  if (s.beat === "vote" && !S.closed[s.slot]) return next();
  const vi = s.beat === "locked" ? s.i - 1 : s.beat === "vote" ? s.i : -1;
  if (vi < 0) return;
  startVote(SCREENS[vi].slot, cfg("extendSeconds", 15));
  S.i = vi;
  commit();
}
function pauseTimer() {
  const s = scr();
  if (s.beat === "think" && S.think.key === s.key && !S.think.done) {
    const t = S.think;
    S.think = t.paused ? { ...t, paused: false, endsAt: Date.now() + t.left } : { ...t, paused: true, left: Math.max(0, t.endsAt - Date.now()) };
    return commit();
  }
  if (s.beat !== "vote" || S.vote.slot !== s.slot || S.vote.locked) return;
  const v = S.vote;
  S.vote = v.paused ? { ...v, paused: false, endsAt: Date.now() + v.left } : { ...v, paused: true, left: Math.max(0, v.endsAt - Date.now()), endsAt: null };
  commit();
}
function extendTimer(sec = cfg("extendSeconds", 15)) {
  const s = scr();
  if (s.beat === "think") {
    const t = S.think;
    const left = (t.done ? 0 : t.paused ? t.left : Math.max(0, t.endsAt - Date.now())) + sec * 1000;
    S.think = { key: s.key, duration: Math.max(t.duration || 0, Math.ceil(left / 1000)), paused: !!t.paused && !t.done, left, endsAt: Date.now() + left };
    return commit();
  }
  if (s.beat !== "vote") return;
  if (S.closed[s.slot] || S.vote.slot !== s.slot) return toggleVote();
  const v = S.vote;
  const left = (v.paused ? v.left : Math.max(0, v.endsAt - Date.now())) + sec * 1000;
  S.vote = { ...v, left, endsAt: v.paused ? null : Date.now() + left, duration: Math.max(v.duration, Math.ceil(left / 1000)) };
  commit();
}
/** Host mode (or overriding Live): the room's pick, by letter or number. index -1 clears. */
function enterPick(index) {
  const s = scr();
  const step = stepOf(C, s);
  if (!step || !isVoteStep(step) || !["vote", "locked"].includes(s.beat)) return;
  if (index === -1) {
    delete S.manual[step.id];
    return commit();
  }
  const o = step.options[index];
  if (!o) return;
  const m = (S.manual[step.id] = { ...(S.manual[step.id] || {}) });
  if (step.format === "pickn") {
    m.picks = m.picks || [];
    if (m.picks.includes(o.id)) m.picks = m.picks.filter((x) => x !== o.id);
    else if (m.picks.length < step.n) m.picks.push(o.id);
    else toast(`The room's top ${step.n} is full. Tap a picked one again to remove it, or Clear.`);
  } else m.choice = m.choice === o.id ? undefined : o.id;
  commit();
}

function commit() {
  save();
  render();
  if (live.on) syncServer();
}

let lastAnnounce = 0;
function tick() {
  if (!S) return;
  updateTimers();
  if (performance.now() - lastAnnounce > 1000) announce();
}

// ------------------------------------------------------------------ toast, modal
/** Messages for the presenter appear in the dock, which shows for a few seconds. */
function toast(msg) {
  lastToast = { text: msg, at: Date.now() };
  showDock(6000);
}
let modalOpen = false;
function modal({ title, text, input, ok, error = "" }) {
  return new Promise((resolve) => {
    modalOpen = true;
    $("#modalBox").innerHTML = `<h3 id="modalTitle">${esc(title)}</h3><p>${esc(text)}</p>${input ? `<input id="modalInput" type="password" maxlength="60" autocomplete="off" aria-labelledby="modalTitle" />` : ""}<div class="err" role="alert">${esc(error)}</div><div class="row"><button type="button" id="modalCancel">Cancel</button><button type="button" class="go" id="modalOk">${esc(ok)}</button></div>`;
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

async function resetGame() {
  let pin = "";
  try { pin = localStorage.getItem(PIN_KEY) ?? ""; } catch {}
  if (live.on) {
    try {
      const r = await adminCall({ action: "reset" }, pin);
      if (!r.ok) return toast("The server couldn't reset the ride. Nothing changed.");
      S = fresh();
      S.round = r.data.state.round;
    } catch {
      return toast("Couldn't reach the server. Nothing was reset.");
    }
  } else S = fresh();
  cardKey = bgKey = hudHTML = roadKey = "";
  prevI = null;
  $("#convoy").innerHTML = "";
  commit();
  toast("Ride reset. Ready in the lobby.");
}

// ------------------------------------------------------------------ commands (the dock and the keyboard)
// ------------------------------------------------------------------ the presenter's dock (on the projector, shown only on mouse move)
// Everything the presenter needs lives here: next/back, timers, Live/Host, sound, notes, placeholders, reset.
// It hides itself (and the cursor) after a few seconds, so the audience sees the story, not the controls.
let dockUntil = 0;
let dockPanel = ""; // "notes" | "todo" | ""
let dockHTML = "";
const ALL_PH = () => {
  const m = new Map();
  SCREENS.forEach((x) => placeholdersOf(C, x).forEach((p) => !m.has(p.what) && m.set(p.what, x.i)));
  return [...m].map(([what, i]) => ({ what, i }));
};
function showDock(ms = 3000) {
  dockUntil = Math.max(dockUntil, Date.now() + ms);
  $("#viewport").classList.add("dock-on");
  renderDock(true);
}
function announce() {
  lastAnnounce = performance.now();
  renderDock();
}
function renderDock(force) {
  if (!S || !SCREENS || (!force && !$("#viewport").classList.contains("dock-on"))) return;
  const s = scr();
  const stop = stopOf(C, s);
  const step = stepOf(C, s);
  const v = voteView();
  const voting = step && isVoteStep(step) && ["vote", "locked"].includes(s.beat);
  const b = (cmd, ic, label = "", cls = "", title = label) => `<button type="button" class="d-btn ${cls}" data-cmd="${cmd}" title="${esc(title)}">${icon(ic)}${label ? `<span>${esc(label)}</span>` : ""}</button>`;
  const ctl = [];
  if (s.beat === "think") {
    const tv = thinkView();
    ctl.push(b("pause", tv?.paused ? "play_arrow" : "pause", "", "", tv?.paused ? "Resume" : "Pause"), b("extend", "add", "15 s", "", "Add 15 seconds"));
  }
  if (s.beat === "vote" && !S.closed[s.slot] && !v.locked) ctl.push(b("pause", v.paused ? "play_arrow" : "pause", "", "", v.paused ? "Resume" : "Pause"), b("extend", "add", "15 s", "", "Add 15 seconds"));
  else if (voting) ctl.push(b("closeVote", "restart_alt", "Reopen voting"));
  if (pumpSkip(C, SCREENS, S.i) != null) ctl.push(b("skip", "skip_next", "Skip refuel"));

  const flags = [];
  if (lowTurnout()) flags.push("Low turnout. Ask the room to join.");
  if (live.on && isPrivateHost(new URL(voteUrl()).hostname) && ["lobby", "vote"].includes(s.beat)) flags.push("Phones can't reach this local address. Set config.publicUrl in en.json.");
  if (!sound.muted && !(sound.ctx && sound.ctx.state === "running") && ["cold", "title", "ignite"].includes(s.beat)) flags.push("Sound is waiting: press any key once.");
  if (voting && !live.on) flags.push(step.format === "pickn" ? `Click the room's top ${step.n} on the screen (or 1–9).` : "Click the room's answer on the screen (or A–D).");
  const toastOn = lastToast.text && Date.now() - lastToast.at < 6000;

  const ph = ALL_PH();
  const here = new Set(placeholdersOf(C, s).map((x) => x.what));
  const core = step?.core || (["handover", "card", "closing"].includes(s.beat) ? [...(stop?.steps || [])].reverse().find((x) => x.core)?.core : "");
  const note = step?.note || (["cold", "title"].includes(s.beat) ? C.coldOpen.note : ["crew", "fact", "crewClose"].includes(s.beat) ? C.crew.note : s.beat === "ignite" ? C.ignition.note : "");
  const panel =
    dockPanel === "notes"
      ? `<div class="d-panel">${core ? `<p>${esc(core)}</p>` : ""}${note ? `<p class="muted">${esc(note)}</p>` : ""}${step?.revealNote && ["think", "vote", "locked"].includes(s.beat) ? `<p class="muted"><b>Reveal:</b> ${esc(step.revealNote)}</p>` : ""}${stop?.steps.some((x) => x.sites) ? `<p>${stop.steps.find((x) => x.sites).sites.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${icon("open_in_new")} ${esc(x.title)}</a>`).join(" ")}</p>` : ""}${!core && !note ? `<p class="muted">No notes for this screen.</p>` : ""}</div>`
      : dockPanel === "todo"
        ? `<div class="d-panel"><b>Placeholders (hidden from the audience)</b><ul>${ph.map((x) => `<li class="${here.has(x.what) ? "here" : ""}"><span>${esc(x.what)}</span><span class="mono">screen ${x.i + 1}</span></li>`).join("")}</ul><p class="muted">Edit public/content/en.json, then reload.</p></div>`
        : "";
  const html = `${toastOn ? `<p class="d-toast">${esc(lastToast.text)}</p>` : ""}${flags.map((f) => `<p class="d-flag">${esc(f)}</p>`).join("")}${panel}
    <div class="d-bar">
      ${b("back", "arrow_back", "", "", "Back")}
      <button type="button" class="d-btn go" data-cmd="next" ${busy || S.i >= last ? "disabled" : ""}>${icon("arrow_forward")}<span>${esc(nextLabel(SCREENS, S.i))}</span></button>
      ${ctl.length ? `<i class="d-sep"></i>${ctl.join("")}` : ""}
      <i class="d-sep"></i>
      ${live.canReturn && !live.on ? b("returnLive", "bolt", "Return to Live", "warn") : `<button type="button" class="d-btn" data-cmd="mode" title="${live.on ? "Switch to Host mode" : "Go live"}"><i class="d-dot ${live.on ? "on" : ""}"></i><span>${live.on ? `Live · ${live.riders}` : U("hostMode")}</span></button>`}
      ${b("mute", sound.muted ? "volume_off" : "volume_up", "", "", sound.muted ? "Sound on" : "Sound off")}
      <button type="button" class="d-btn ${dockPanel === "notes" ? "on" : ""}" data-panel="notes" title="Notes">${icon("menu_book")}</button>
      ${ph.length ? `<button type="button" class="d-btn amber ${dockPanel === "todo" ? "on" : ""} ${here.size ? "here" : ""}" data-panel="todo" title="Placeholders">${icon("pending")}<span>${ph.length}</span></button>` : ""}
      ${b("reset", "restart_alt", "", "", "Reset the ride")}
    </div>`;
  if (html === dockHTML) return;
  dockHTML = html;
  $("#dock").innerHTML = html;
}
$("#dock").addEventListener("click", (e) => {
  const pb = e.target.closest("[data-panel]");
  if (pb) {
    dockPanel = dockPanel === pb.dataset.panel ? "" : pb.dataset.panel;
    return renderDock(true);
  }
  const cb = e.target.closest("[data-cmd]");
  if (!cb || cb.disabled) return;
  if (cb.dataset.cmd === "reset" && !confirm(live.on ? "Reset the ride? This clears every answer on the server and returns to the lobby." : "Reset the ride? This clears the room's answers and returns to the lobby.")) return;
  runCommand({ cmd: cb.dataset.cmd });
  showDock();
});
addEventListener("mousemove", () => showDock());
setInterval(() => {
  const vp = $("#viewport");
  if (vp.classList.contains("dock-on") && Date.now() > dockUntil && !dockPanel && !$("#dock").matches(":hover") && !(lastToast.text && Date.now() - lastToast.at < 6000)) vp.classList.remove("dock-on");
}, 500);
/** Host mode (or overriding Live): click an answer on the stage to mark it as the room's pick. */
$("#main").addEventListener("click", (e) => {
  const o = e.target.closest(".opt[data-o]");
  const s = scr();
  const step = stepOf(C, s);
  if (!o || !step || !isVoteStep(step) || !["vote", "locked"].includes(s.beat)) return;
  enterPick(step.options.findIndex((x) => x.id === o.dataset.o));
});

function runCommand(c) {
  if (!c || !S || modalOpen) return;
  switch (c.cmd) {
    case "next": return next();
    case "back": return back();
    case "skip": return skip();
    case "closeVote": return toggleVote();
    case "pause": return pauseTimer();
    case "extend": return extendTimer(Number(c.arg) || cfg("extendSeconds", 15));
    case "key": return typeof c.key === "string" && handleKey(c.key);
    case "mute": return toggleMute();
    case "mode": return live.on ? fallbackToHost("Host mode: enter the room's answers by hand.") : enableLive(false);
    case "returnLive": return enableLive(false);
    case "reset": return resetGame();
  }
}

// ------------------------------------------------------------------ Live mode
async function fetchT(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal, cache: "no-store" }); } finally { clearTimeout(t); }
}
async function adminCall(body, pin) {
  let p = pin;
  if (p == null) try { p = localStorage.getItem(PIN_KEY); } catch {}
  const r = await fetchT(`${location.origin}/api/admin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pin: p }) });
  let data = null;
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}
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
  if (!up) return fallbackToHost(silent || live.hostOnly ? null : "Can't reach the live server. Staying in Host mode.");
  let pin = null;
  try { pin = localStorage.getItem(PIN_KEY); } catch {}
  let error = "";
  for (let k = 0; k < 5; k++) {
    if (!pin) {
      pin = await modal({ title: "Go live", text: "Enter the presenter PIN.", input: true, ok: "Go live", error });
      if (pin === null) return fallbackToHost(null);
    }
    let r;
    try { r = await adminCall({ action: "check" }, pin); } catch { return fallbackToHost("Can't reach the live server. Staying in Host mode."); }
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
    cardKey = hudHTML = "";
    connectWS();
    startPolling();
    commit(); // the game carries on where it is
    if (!silent || wasLost) toast(wasLost ? "Back to Live. Phones rejoin on the current step." : `Live voting on: ${shortUrl()}`);
    return;
  }
}
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
  cardKey = hudHTML = "";
  save();
  render();
  if (msg) toast(msg);
}
let lastHealth = 0;
function watchdog() {
  const now = Date.now();
  if (live.on && now - live.lastOk > LOST_AFTER_MS) return fallbackToHost("Lost the live server for 5 seconds. Switched to Host mode; answers so far are kept.");
  if (!live.on && !live.hostOnly && S && wantLive() && now - lastHealth > 3000) {
    lastHealth = now;
    serverUp(2000)
      .then((ok) => {
        if (ok !== live.canReturn) {
          live.canReturn = ok;
          if (ok && live.lost) toast("The live server is back. Press Return to Live.");
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
      live.pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 2000);
    };
    ws.onmessage = (ev) => {
      live.lastOk = Date.now();
      if (ev.data === "pong") return;
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "state") applyServerState(m.state);
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
    } catch {}
  }, 1000);
}
function applyServerState(st) {
  if (!st || !live.on) return;
  if (st.round !== S.round) {
    S.round = st.round;
    S.tallies = {};
  }
  // Tallies only for the step on screen, and only until its votes lock
  if (st.tally && st.slot === scr().slot && !S.final[st.slot]) S.tallies[st.slot] = st.tally;
  if (typeof st.riders === "number") live.riders = st.riders;
  save();
  updateResults();
  updatePlayers();
  updateGauge();
}
function desired() {
  const s = scr();
  return { slot: s.slot, phase: phaseOf(s, !!S.closed[s.slot] || (s.beat === "vote" && S.vote.slot !== s.slot)) };
}
let seqN = 0;
function syncServer() {
  const want = { ...desired(), seq: Date.now() * 1000 + (seqN++ % 1000) };
  const s = scr();
  const v = voteView();
  const vote = s.beat === "vote" && v.slot === s.slot ? { remainingMs: v.remainingMs, duration: v.duration, paused: v.paused, locked: v.locked || !!S.closed[s.slot] } : null;
  live.chain = live.chain.then(async () => {
    if (!live.on) return;
    try {
      const r = await adminCall({ action: "set", slot: want.slot, phase: want.phase, seq: want.seq, vote });
      if (r.status === 401) return fallbackToHost("The server didn't accept the PIN. Staying in Host mode.");
      if (!r.ok) throw new Error(r.status);
      live.lastOk = Date.now();
      applyServerState(r.data.state);
    } catch {
      setTimeout(() => live.on && syncServer(), 1500);
    }
  });
}

// ------------------------------------------------------------------ keyboard (and clickers)
function handleKey(k) {
  if (["ArrowRight", " ", "PageDown", "Enter"].includes(k)) return next(), true;
  if (["ArrowLeft", "PageUp", "Backspace"].includes(k)) return back(), true;
  if (k === "v" || k === "V") return toggleVote(), true;
  if (k === "p" || k === "P") return pauseTimer(), true;
  if (k === "+" || k === "=") return extendTimer(), true;
  if (k === "m" || k === "M") return toggleMute(), true;
  if (k === "s" || k === "S") return skip(), true;
  if (k === "l" || k === "L") return runCommand({ cmd: "mode" }), true;
  if (/^[1-9]$/.test(k)) return enterPick(Number(k) - 1), true;
  if (k === "0") return enterPick(-1), true;
  if (/^[a-dA-D]$/.test(k)) return enterPick(k.toUpperCase().charCodeAt(0) - 65), true;
  return false;
}
addEventListener("keydown", (e) => {
  if (modalOpen || e.ctrlKey || e.metaKey || e.altKey || !S) return;
  const k = e.key;
  if (k === "f" || k === "F") return e.preventDefault(), document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.().catch(() => {});
  if (handleKey(k)) e.preventDefault();
});

window.__ride = { get state() { return S; }, get screens() { return SCREENS; }, nextLabel: () => nextLabel(SCREENS, S.i) };
init();
