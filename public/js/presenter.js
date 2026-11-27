/* The Ride: projector — the one screen the presenter runs the whole session from.
 * The route is one ordered list of screens (route.js → buildScreens), one per story beat. The dock's main
 * button (or → / Space / a clicker) moves to the next screen. Rides and the ignition play by themselves.
 * Everything is saved in localStorage, so a reload resumes exactly.
 * Live is the default: the Worker relays votes from phones. If it is silent for 5 s, Host mode takes over.
 */
import { buildScreens, nextLabel, convoyAt, routeAt, stepOf, stopOf, placeOf, phaseOf, pumpSkip, placeholdersOf, filled, fmt, esc, km, isVoteStep, LETTERS } from "./route.js";
import { tripAt, routes, movesClock, optionOf, clockText, deltaText, durText, rupeeText, vsIdeal, effectChips, typeLabel, longText, idealMinutes, savedAndCost } from "./engine.js";
import { PAL, lightOf, groundOf, vergeSVG } from "./scenes.js";
import { icon } from "./icons.js";
import { pill, personaIcon, stopPersona, bike, milestone, route, optionCard, qr, clock, nut, clockFace, chipsHTML, detourSign, avatar, who } from "./ui.js";

const $ = (s) => document.querySelector(s);
const STORE = "ride.state.v12";
const PIN_KEY = "ride.pin";
const MUTE_KEY = "ride.muted";
const FIRE_MS = 2600;
const LOST_AFTER_MS = 5000;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let C, SCREENS, last, S;
let STEP = {}; // step id → step
let RULES_I = 0; // the trip dashboard shows from the rules screen on
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
const isPrivateHost = (h) => /^(localhost|127\.|\[?::1\]?$)/.test(h); // only this machine; a LAN address works for phones on the same Wi-Fi
// On the office Wi-Fi (npm run lan), public/lan.json holds this laptop's current address: the QR code follows it,
// so the projector can stay on http://localhost:8787 while phones get the address that works today.
let lanUrl = "";
const onLocalNet = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/.test(h);
const voteUrl = () => (filled(cfg("publicUrl", "")) ? cfg("publicUrl", "").replace(/\/+$/, "") : lanUrl || location.origin) + "/v";
async function loadLan() {
  if (!onLocalNet(location.hostname)) return;
  try {
    const j = await (await fetch("lan.json", { cache: "no-store" })).json();
    if (j?.url && j.url !== lanUrl) {
      lanUrl = j.url;
      if (S) {
        cardKey = hudHTML = "";
        render();
      }
    }
  } catch {}
}
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
  /** A card turning: a low thud under a rising shimmer. */
  flip() { this.tone(82, 0.45, 0, 0.1); this.tone(55, 0.6, 0.02, 0.08); this.tone(784, 0.18, 0.28, 0.03); this.tone(1175, 0.4, 0.4, 0.025); },
  /** A clunk and a rattle: the convoy stops for a broken bolt. */
  detour() { this.tone(98, 0.3, 0, 0.09); this.tone(73, 0.35, 0.1, 0.08); [0.35, 0.47, 0.56, 0.62].forEach((at, k) => this.tone(1500 - k * 160, 0.05, at, 0.025)); },
  // ---- The engine: the original "Fire it up" rev (a rising saw pair through an opening low-pass, a burst, then
  // settling), used for every movement, stretched to fit it. Each bike in the convoy plays it, slightly detuned,
  // on the same timeline, so the convoy revs as one.
  stopIdle() {}, // silent at rest
  rev(ms = FIRE_MS, bikes = 1) {
    if (!this.ok()) return;
    const c = this.ctx;
    const t = c.currentTime;
    const k = ms / FIRE_MS; // stretch the original 2.6 s shape
    const n = Math.max(1, bikes);
    const each = 1 / Math.sqrt(n);
    for (let b = 0; b < n; b++) {
      const d = 1 + (b - (n - 1) / 2) * 0.015;
      const o = c.createOscillator();
      const o2 = c.createOscillator();
      o.type = o2.type = "sawtooth";
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      const g = c.createGain();
      o.frequency.setValueAtTime(45 * d, t);
      o.frequency.exponentialRampToValueAtTime(190 * d, t + 1.1 * k);
      o.frequency.exponentialRampToValueAtTime(120 * d, t + 2.2 * k);
      o2.frequency.setValueAtTime(68 * d, t);
      o2.frequency.exponentialRampToValueAtTime(280 * d, t + 1.1 * k);
      o2.frequency.exponentialRampToValueAtTime(180 * d, t + 2.2 * k);
      lp.frequency.setValueAtTime(250, t);
      lp.frequency.exponentialRampToValueAtTime(1300, t + 1.1 * k);
      lp.frequency.exponentialRampToValueAtTime(500, t + 2.4 * k);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12 * each, t + 0.25 * k);
      g.gain.setValueAtTime(0.12 * each, t + 1.3 * k);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6 * k);
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g).connect(c.destination);
      o.start(t); o2.start(t);
      o.stop(t + 2.7 * k); o2.stop(t + 2.7 * k);
    }
  },
  // Every movement plays the very same rev as "Fire it up": same length, one voice (the convoy moves as one,
  // so one rev in step with it; copies on top of each other only blur the sound).
  roar() { this.rev(FIRE_MS, 1); },
  ride() { this.rev(FIRE_MS, 1); },
  nudge() { this.rev(FIRE_MS, 1); },
};
addEventListener("keydown", () => sound.wake(), { capture: true });
addEventListener("pointerdown", () => sound.wake(), { capture: true });
/** The engine idles under the cold open and the title card only. */
function syncSound() {
  if (!S) return;
  const b = scr().beat;
  sound.stopIdle(); // the engine is silent at rest; it sounds only when the bikes move (and on Fire it up)
  announce();
}
function toggleMute() {
  sound.muted = !sound.muted;
  try { localStorage.setItem(MUTE_KEY, sound.muted ? "1" : "0"); } catch {}
  if (sound.muted) sound.stopIdle();
  syncSound();
  toast(sound.muted ? "Sound off" : "Sound on");
}

// ------------------------------------------------------------------ the trip: arrival clock, fuel bill, loose bolts (engine.js)
/** The room's choice at a question: the presenter's pick (Host mode, or a tie broken), else the one answer with
 *  the most votes. A tie, or no votes at all, is no choice yet: the presenter picks. */
function roomChoice(step) {
  if (!step) return null;
  const m = S.manual[step.id] || {};
  if (m.choice) return m.choice;
  const top = tiedIds(step);
  return top.length === 1 ? top[0] : null;
}
/** The answers sharing the most votes (one when there's a clear winner). */
function tiedIds(step) {
  const t = tallyOf(step.id);
  const ids = step.options.map((o) => o.id);
  const max = Math.max(0, ...ids.map((id) => t.counts[id] || 0));
  return max ? ids.filter((id) => (t.counts[id] || 0) === max) : [];
}
const choiceOf = (id) => roomChoice(STEP[id]);
const trip = (i = S.i) => tripAt(C, SCREENS, i, choiceOf);
/** A DETOUR screen is passed over when its bolt isn't loose by then. */
const skipAt = (t) => SCREENS[t]?.beat === "detour" && !trip(t - 1).loose.includes(SCREENS[t].bolt);
const nextFrom = (t) => { while (t <= last && skipAt(t)) t++; return t; };
const stopById = (id) => C.stops.find((x) => x.id === id);
/** "Adilabad · Village square", "Petrol pump", "Travancore Palace". */
function stopLabel(st) {
  if (!st) return "";
  const p = placeOf(C, st);
  if (!p) return st.spot;
  return C.stops.filter((x) => x.place === st.place).length > 1 ? `${p.name} · ${st.spot}` : p.name;
}
/** Where a bolt was planted (the stop whose option carries it). */
const boltHome = (id) => C.stops.find((st) => st.steps.some((x) => x.options?.some((o) => o.bolt === id)));
const boltChips = (id) => effectChips(C, { minutes: C.bolts[id].minutes, rupees: C.bolts[id].rupees });
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
  STEP = Object.fromEntries(C.stops.flatMap((st) => st.steps).map((x) => [x.id, x]));
  RULES_I = Math.max(0, SCREENS.findIndex((x) => x.beat === "rules"));
  try { await Promise.all(["700 56px Playfair", "600 36px Playfair", "400 15px Poppins", "600 14px Poppins", "500 14px 'Red Hat Mono'"].map((f) => document.fonts.load(f))); } catch {}
  S = loadState();
  // A reload in the middle of a ride or the ignition lands where it was heading
  if (scr().transient) S.i = Math.min(last, nextFrom(S.i + 1));
  // A reload on THINK waits for the presenter instead of opening voting at once
  if (scr().beat === "think") S.think = { key: scr().key, done: true, duration: cfg("thinkSeconds", 15) };
  $("#detour").innerHTML = detourSign(C.ui.detourSign);
  await loadLan();
  setInterval(loadLan, 15000);
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
const PROLOGUE = ["cold", "title", "crew", "fact", "crewClose", "ignite", "fired", "rules"];
const AFTER = ["reveal", "takeaway", "handover", "card", "closing"]; // the room's answer is known: highlight it
let cardKey = "";
let bgKey = "";
let hudHTML = "";

function render() {
  const s = scr();
  // Forward one beat (passing over detours that didn't happen): only then do things animate
  const forward = prevI != null && S.i > prevI && SCREENS.slice(prevI + 1, S.i).every((x) => skipAt(x.i));
  const stop = stopOf(C, s);
  const T = trip();
  const st = $("#stage");
  document.body.dataset.beat = s.beat;
  st.dataset.beat = s.beat;
  st.dataset.p = s.beat === "lobby" || PROLOGUE.includes(s.beat) || s.beat === "ride" ? "crew" : s.beat === "detour" ? C.bolts[s.bolt]?.persona || "crew" : stopPersona(stop);
  st.classList.toggle("live", live.on);
  st.classList.toggle("riding", s.beat === "ride" || s.beat === "fired");
  st.classList.toggle("trip-on", S.i >= RULES_I);
  st.classList.toggle("focus-site", !!s.focus);
  // Running late darkens the world a little (up to four hours late)
  st.style.setProperty("--late", S.i >= RULES_I ? Math.max(0, Math.min(1, T.minutes / 240)).toFixed(3) : "0");
  renderBackdrop(s, stop);
  renderHud(s, stop);
  renderCard(s, stop, forward);
  renderRoad(s, stop, forward, T);
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

// ------------------------------------------------------------------ backdrop: one world (scenes.js)
// Far layer (sky, far hills, haze) and near layer (everything nearer), the sun between them, then one grade for
// every scene: haze on the horizon, a light tint toward the stop's persona, and darker when the room runs late.
// The verge (roadside strip in the scene's own ground colour) bridges the backdrop and the asphalt.
function sceneOf(s, stop) {
  if (s.beat === "lobby") return "workbench";
  if (PROLOGUE.includes(s.beat)) return "prologue"; // Bengaluru's edge at dusk, before the convoy sets off
  if (s.beat === "ride" || s.onRoad) {
    // One panorama per leg, by the next place on the route (the pump sits on the leg to Nagpur)
    const next = C.stops.slice(s.stop).find((x) => placeOf(C, x));
    return `road-${Math.max(1, C.places.indexOf(placeOf(C, next)))}`;
  }
  return stop?.scene || "prologue";
}
/** Backdrop pixels (1920×1080) → stage pixels: drawn at 1600×900, 80 px past each side and 45 px above. */
const bgX = (x) => (x * 5) / 6 - 80;
const bgY = (y) => (y * 5) / 6 - 45;
function renderBackdrop(s, stop) {
  const k = sceneOf(s, stop);
  if (k === bgKey) return;
  bgKey = k;
  const pal = PAL[k] || PAL.prologue;
  const src = cfg("backdrops", {})[k];
  const el = swap($("#backdrop"), `<div class="far-wrap"><div class="far"></div></div><i class="sun${pal.disc ? " disc" : ""}" style="left:${bgX(pal.sun[0])}px;top:${bgY(pal.sun[1])}px"></i><div class="near-wrap"><div class="near"></div></div><i class="haze"></i><i class="tint"></i><i class="dusk"></i>`);
  el.dataset.scene = k;
  el.classList.toggle("pano", k.startsWith("road-"));
  if (src) loadLayers(el, src);
  const v = swap($("#verge"), "");
  v.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(vergeSVG(k))}")`;
  // One light for the scene: the riders take its colour as a rim, and cast their shadows away from it
  const L = lightOf(k);
  const st = $("#stage");
  st.style.setProperty("--light", L.color);
  st.style.setProperty("--lx", L.dir.toFixed(2));
  st.style.setProperty("--ground", groundOf(k));
}

/** A scene's two layers (<name>-far.webp, <name>-near.webp). A single picture (<name>.webp, .jpg or .png,
 *  for a hand-made backdrop) also works: it fills the far layer. */
const BACKDROP_TYPES = ["webp", "jpg", "png"];
function loadLayers(layer, base) {
  const set = (sel, url) => {
    if (!layer.isConnected) return;
    const d = layer.querySelector(sel);
    d.style.backgroundImage = `url("${url}")`;
    d.classList.add("ok");
  };
  const single = (k) => {
    if (k >= BACKDROP_TYPES.length || !layer.isConnected) return;
    const im = new Image();
    im.onload = () => set(".far", im.src);
    im.onerror = () => single(k + 1);
    im.src = `${base}.${BACKDROP_TYPES[k]}`;
  };
  const far = new Image();
  far.onload = () => {
    set(".far", far.src);
    const near = new Image();
    near.onload = () => set(".near", near.src);
    near.src = `${base}-near.webp`;
  };
  far.onerror = () => single(0);
  far.src = `${base}-far.webp`;
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
/** Answers sit beside a side panel (timer, QR, info card). Stop 1's guess sits beside the two websites instead. */
const sideLayout = (step) => !!step && step.type !== "guess" && !["pickn", "badges"].includes(step.format);

const OWN_CARD = ["arrive", "ride", "detour", "dash", "ledger", "routes", "closing", "signoff", "gather", "rules"];
/** Insight Out (a card step with a link) fills the stage instead of sitting in the side panel. */
const isInsight = (s) => s.beat === "card" && "link" in (stepOf(C, s) || {});
function cardKeyOf(s, stop) {
  if (s.beat === "lobby") return `lobby|${live.on}|${voteUrl()}`;
  if (OWN_CARD.includes(s.beat) || isInsight(s)) return s.key;
  if (s.beat === "cold") return s.line >= C.coldOpen.cards.length ? "coldline" : "cold";
  if (s.focus) return s.key;
  if (PROLOGUE.includes(s.beat)) return "prologue";
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
  if (s.beat === "rules") {}
  else if (s.beat === "cold") s.line < C.coldOpen.cards.length && patchCold(root, s, forward);
  else if (PROLOGUE.includes(s.beat)) patchPrologue(root, s);
  else if (stop && !OWN_CARD.includes(s.beat) && !isInsight(s) && !s.focus) patchStop(root, s, stop);
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
  if (h > room) card.style.transform = `scale(${Math.max(0.7, room / h).toFixed(3)})`;
}

function cardHTML(s, stop) {
  if (s.beat === "lobby") return lobbyHTML();
  if (s.beat === "rules") return rulesHTML();
  if (s.focus) return siteFocusHTML(stop);
  if (s.beat === "cold") return s.line >= C.coldOpen.cards.length ? coldLineHTML() : coldHTML();
  if (PROLOGUE.includes(s.beat)) return prologueHTML();
  if (s.beat === "ride") return rideHTML(s, stop);
  if (s.beat === "arrive") return arriveHTML(stop);
  if (s.beat === "detour") return detourHTML(s);
  if (s.beat === "dash") return dashHTML(s, stop);
  if (s.beat === "ledger") return ledgerHTML(s, stop);
  if (s.beat === "routes") return routesHTML(s);
  if (s.beat === "closing" || s.beat === "signoff") return closingHTML(s, stop);
  if (s.beat === "gather") return gatherHTML(stop);
  if (isInsight(s)) return insightHTML(stepOf(C, s));
  const ctx = ctxOf(s, stop);
  if (stop.steps.some((x) => x.sites) && (!ctx || ctx.type === "guess")) return sitesCardHTML(s, stop);
  return stopCardHTML(s, stop);
}

// ------------------------------------------------------------------ the trip's own cards: rules, detour, fuel bill, ledger, routes
// The cold open, one scene: four cards face down (only the place shows). Each turn lifts a card, spins it over
// with a thud and reveals the person and their story, the hook. All four stay side by side so the room keeps them
// in mind; then the last line appears under them.
function coldHTML() {
  const CO = C.coldOpen;
  const cards = CO.cards.map((c, k) => {
    const p = C.personas[c.persona];
    return `<article class="cc" data-p="${esc(c.persona)}" data-k="${k}"><div class="cc-in">
      <div class="cc-face cc-front"><span class="avatar cc-av mystery">?</span><span class="cc-name">???</span><span class="label-sm caps cc-role">${esc(c.place)}</span><span class="cc-bars"><i></i><i></i><i></i></span></div>
      <div class="cc-face cc-back">${avatar(C, c.persona, "cc-av")}<span class="cc-name">${esc(p.name)}</span><span class="cc-tag">${esc(p.role)}</span><p class="cc-line balance">${esc(c.hook || c.line)}</p></div>
    </div></article>`;
  }).join("");
  return `<div class="card coldcards" data-p="crew"><div class="cc-grid">${cards}</div></div>`;
}
/** The next scene: the four of them in a row, and the line that sets the ride going. */
function coldLineHTML() {
  const CO = C.coldOpen;
  return `<div class="card prologue coldline" data-p="crew"><div class="cl-row">${CO.cards.map((c, k) => `<span class="cl-who" style="--k:${k}">${avatar(C, c.persona, "cl-av")}<span class="label-lg">${esc(C.personas[c.persona].name)}</span><span class="cc-tag sm" data-p="${esc(c.persona)}">${esc(C.personas[c.persona].role)}</span></span>`).join("")}</div><h1 class="cl-line balance">${esc(CO.line || "")}</h1>${CO.lineYou ? `<p class="cl-you balance">${esc(CO.lineYou)}</p>` : ""}${CO.cue ? `<span class="cl-cue label-lg">${icon("front_hand")}${esc(CO.cue)}</span>` : ""}</div>`;
}
function patchCold(root, s, forward) {
  root.querySelectorAll(".cc").forEach((c) => {
    const on = Number(c.dataset.k) <= s.line;
    if (on && !c.classList.contains("flipped") && forward && !reduceMotion()) {
      c.classList.remove("just");
      void c.offsetWidth;
      c.classList.add("just");
      sound.flip();
      // Spotlight: everything else dims while this one turns
      const box = root.querySelector(".coldcards");
      box.classList.add("focus");
      clearTimeout(box._t);
      box._t = setTimeout(() => box.classList.remove("focus"), 2200);
    }
    c.classList.toggle("flipped", on);
    c.classList.toggle("next", Number(c.dataset.k) === s.line + 1);
  });
}
/** The website in the foreground: a browser frame, the whole page scrollable (mouse wheel, or ↓ ↑). */
function siteFocusHTML(stop) {
  const site = stop.steps.find((x) => x.sites).sites[0];
  const host = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `<div class="card site-focus" data-p="crew">
    <div class="sf-bar"><span class="sf-dots"><i></i><i></i><i></i></span><span class="sf-url mono-md">${icon("lock")} ${esc(host)}</span><span class="label-sm muted">Scroll ↓</span></div>
    <div class="sf-scroll" data-scroll><img src="${esc(site.page || site.image)}" alt="${esc(`The ${site.title} website`)}" /></div>
  </div>`;
}
function scrollSite(dy) {
  const el = current()?.querySelector("[data-scroll]");
  if (!el) return false;
  el.scrollBy({ top: dy, behavior: reduceMotion() ? "auto" : "smooth" });
  return true;
}
function rulesHTML() {
  const R = C.rules;
  const ics = [clockFace(idealMinutes(C), "rule-ic"), icon("local_gas_station", "rule-ic"), nut("rule-ic"), icon("flag", "rule-ic")];
  return `<div class="card rules" data-p="crew">
    <h1 class="display-md balance">${esc(fmt(R.title, { time: clockText(C, 0) }))}</h1>
    <ul class="rule-lines">${R.lines.map((l, k) => `<li style="--k:${k}">${ics[k] || ""}<span class="headline-md pretty">${esc(l)}</span></li>`).join("")}</ul>
  </div>`;
}
function detourHTML(s) {
  const b = C.bolts[s.bolt];
  const home = boltHome(s.bolt);
  return `<div class="card detour" data-p="${esc(b.persona)}">
    <div class="row"><span class="pill persona" data-p="${esc(b.persona)}">${nut()}<span class="label-lg">${esc(fmt(C.ui.plantedAt, { spot: home?.spot || "" }))}</span></span></div>
    <h1 class="display-md">${esc(C.ui.detour)}</h1>
    <p class="msg headline-md pretty">${esc(b.message)}</p>
    ${chipsHTML(boltChips(s.bolt), "big")}
  </div>`;
}
/** The petrol pump, a pause to reflect: where we'd arrive, the fuel bill, any bolts, and one question. */
function dashHTML(s, stop) {
  const step = stepOf(C, s);
  const T = trip();
  const n = T.planted.length;
  const bolts = n ? `<div class="readout bolts-sm">${nut(T.loose.length ? "wobble big-nut" : "big-nut")}<div><span class="label-sm caps muted">${esc(C.ui.looseBolts)}</span><b class="display-md">${T.broken.length} / ${n}</b><span class="mono-md muted">broke so far</span></div></div>` : "";
  return `<div class="card dash-card" data-p="lakshmi">
    <div class="readouts ${n ? "three" : ""}">
      <div class="readout ${T.minutes > 0 ? "late" : ""}">${clockFace(T.minutes + idealMinutes(C), "big-clock")}<div><span class="label-sm caps muted">${esc(C.ui.arrival)}</span><b class="display-md">${esc(clockText(C, T.minutes))}</b><span class="mono-md">${esc(vsIdeal(C, T.minutes))}</span></div></div>
      <div class="readout">${icon("local_gas_station", "big-ic")}<div><span class="label-sm caps muted">${esc(C.ui.fuelBill)}</span><b class="display-md">${esc(rupeeText(T.rupees))}</b></div></div>
      ${bolts}
    </div>
    ${step.prompt ? `<p class="prompt balance">${esc(step.prompt)}</p>` : ""}
  </div>`;
}
/** This room's run: arrival, fuel bill, the choice at each stop with its effect, bolts planted and broken. */
function ledgerHTML(s, stop) {
  const step = stepOf(C, s);
  const T = trip();
  const rows = [];
  for (const sc of SCREENS) {
    if (sc.i > S.i) break;
    const ch = T.choices.find((c) => c.screen === sc.i);
    if (ch) {
      const st = C.stops[ch.stop];
      const q = st.steps.find((x) => x.id === ch.step);
      const o = optionOf(q, ch.option);
      rows.push(`<li data-p="${esc(stopPersona(st))}"><span class="where label-lg pcb">${esc(st.short || st.spot)}</span><span class="what body-md"><b class="mono-md">${esc(o.id)}</b> ${esc(o.text)}</span>${chipsHTML(effectChips(C, o))}</li>`);
    }
    const br = T.broken.find((b) => b.screen === sc.i);
    if (br) rows.push(`<li class="broke" data-p="${esc(C.bolts[br.id].persona)}"><span class="where label-lg">${nut()} ${esc(C.ui.detour)}</span><span class="what body-md muted">${esc(C.bolts[br.id].label)}</span>${chipsHTML(boltChips(br.id))}</li>`);
  }
  return `<div class="card ledger" data-p="crew">
    <div class="ledger-head">
      <div><span class="mono-md caps pcb">${esc(step.title)} · ${esc(step.subtitle || "")}</span><h1 class="display-md">${esc(clockText(C, T.minutes))}</h1><span class="mono-md ${T.minutes > 0 ? "warn" : "ok"}">${esc(vsIdeal(C, T.minutes))} · ${esc(fmt(C.ui.vsIdeal, { time: clockText(C, 0) }))}</span></div>
      <div class="stat"><span class="label-sm caps muted">${esc(C.ui.fuelBill)}</span><b class="headline-lg">${esc(rupeeText(T.rupees))}</b></div>
      <div class="stat"><span class="label-sm caps muted">${esc(C.ui.looseBolts)}</span><b class="headline-lg">${T.planted.length} → ${T.broken.length}</b><span class="label-sm muted">${esc(C.ui.plantedBroken)}</span></div>
    </div>
    <ul class="ledger-rows">${rows.join("")}</ul>
  </div>`;
}
/** The three routes (worked out from the content) and the room's own, as lines along the route. */
function routesHTML(s) {
  const T = trip();
  const R = routes(C, SCREENS);
  const room = { id: "room", name: C.routes.room, trip: T };
  const pts = (trip) => [0, ...C.stops.map((_, si) => trip.atStop[si] ?? 0)];
  const all = [...R, room].map((r) => pts(r.trip));
  const lo = Math.min(-60, ...all.flat()), hi = Math.max(120, ...all.flat());
  const W = 1240, H = 200, L = 90, Rr = 200, Tp = 12, B = 30; // wide and flat: the card must clear the road
  const x = (k) => L + (k * (W - L - Rr)) / C.stops.length;
  const y = (m) => Tp + ((hi - m) * (H - Tp - B)) / (hi - lo);
  const line = (r, cls) => `<polyline class="rt ${cls}" points="${pts(r.trip).map((m, k) => `${x(k).toFixed(1)},${y(m).toFixed(1)}`).join(" ")}"/>`;
  const end = (r, cls) => `<text class="rt-end ${cls}" x="${x(C.stops.length) + 10}" y="${(y(r.trip.minutes) + 5).toFixed(1)}">${esc(clockText(C, r.trip.minutes))}</text>`;
  // End labels can collide: nudge them apart
  const ends = [...R, room].map((r) => ({ r, yy: y(r.trip.minutes) })).sort((a, b) => a.yy - b.yy);
  for (let k = 1; k < ends.length; k++) if (ends[k].yy - ends[k - 1].yy < 18) ends[k].yy = ends[k - 1].yy + 18;
  const same = R.find((r) => C.stops.every((st) => st.steps.every((q) => !movesClock(q) || r.picks[q.id] === choiceOf(q.id))));
  const svg = `<svg class="route-chart" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <line class="ideal" x1="${L}" x2="${x(C.stops.length)}" y1="${y(0)}" y2="${y(0)}"/><text class="axis" x="${L - 10}" y="${y(0) + 4}" text-anchor="end">${esc(clockText(C, 0))}</text>
    ${C.stops.map((st, k) => `<line class="tick" x1="${x(k + 1)}" x2="${x(k + 1)}" y1="${Tp}" y2="${H - B}"/><text class="axis" x="${x(k + 1)}" y="${H - 12}" text-anchor="middle">${esc(st.short || st.spot)}</text>`).join("")}
    ${R.map((r) => line(r, r.id)).join("")}${line(room, "room")}
    ${ends.map(({ r, yy }) => `<text class="rt-end ${r.id}" x="${x(C.stops.length) + 10}" y="${(yy + 5).toFixed(1)}">${esc(r.id === "room" ? `${C.routes.room} ${clockText(C, r.trip.minutes)}` : clockText(C, r.trip.minutes))}</text>`).join("")}
  </svg>`;
  const cards = R.map((r) => `<article class="route-card ${r.id} ${same === r ? "is-room" : ""}"><span class="label-lg nm">${esc(r.name)}</span><b class="headline-lg">${esc(clockText(C, r.trip.minutes))}</b><span class="mono-md">${esc(rupeeText(r.trip.rupees))} · ${r.trip.planted.length ? `${r.trip.planted.length} bolts` : C.ui.noBolts}</span>${filled(r.line) ? `<p class="body-md pretty">${esc(fmt(r.line, { saved: longText(C, r.saved), cost: longText(C, r.cost) }))}</p>` : ""}${same === r ? `<span class="label-sm room-tag">${esc(C.routes.room)}</span>` : ""}</article>`).join("");
  return `<div class="card routes" data-p="crew">
    <div class="row between"><h1 class="headline-lg">${esc(C.routes.title)}</h1><span class="room-key label-lg"><i></i>${esc(C.routes.room)}: ${esc(clockText(C, T.minutes))} · ${esc(rupeeText(T.rupees))}</span></div>
    ${svg}
    <div class="route-cards">${cards}</div>
  </div>`;
}
function insightHTML(step) {
  const link = filled(step.link) ? step.link : "";
  const title = esc(step.title || "");
  const highlightedTitle = title.replace("Insight Out", '<mark class="ins-highlight">Insight Out</mark>');
  return `<div class="card insight" data-p="crew">
    <div class="ins-main"><span class="mono-md caps pcb">Insight Out</span><h1 class="display-lg balance">${highlightedTitle}</h1><p class="ins-text pretty">${esc(step.text)}</p></div>
    ${link ? `<div class="ins-link"><div class="qr-box" data-qr="${esc(link)}"></div><span class="mono-lg">${esc(link.replace(/^https?:\/\//, ""))}</span></div>` : ""}
  </div>`;
}
function gatherHTML(stop) {
  return `<div class="card stop gather" data-p="crew"><div class="col-main">
    <div class="opts n4 travellers">${stop.gathering.map((g) => `<div class="opt trav" data-p="${esc(g.persona)}"><div class="opt-top"><span class="who label-lg">${icon(personaIcon(C, g.persona))}${esc(who(C, g.persona))}</span></div><p class="t headline-md">“${esc(g.line)}”</p></div>`).join("")}</div>
  </div></div>`;
}
function closingHTML(s, stop) {
  const step = stepOf(C, s);
  if (s.beat === "signoff") return `<div class="card prologue signoff" data-p="crew"><h1 class="display-lg balance">${esc(step.signoff)}</h1></div>`;
  // A few short phrases to talk around (the full text is in the presenter's notes)
  if (step.lines?.length) return `<div class="card prologue closing" data-p="crew"><ul class="closing-lines">${step.lines.map((l, k) => `<li style="--k:${k}" class="${k === step.lines.length - 1 ? "last" : ""}">${esc(l)}</li>`).join("")}</ul></div>`;
  return `<div class="card prologue closing" data-p="crew"><p class="body-lg pretty closing-text">${esc(step.text)}</p></div>`;
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
    <p class="headline-md muted">${esc(stop.arrival ? U("fullConvoy") : stop.arriveLine || (p ? stop.spot : ""))}</p>
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
  if (["think", "vote", "locked"].includes(s.beat) && ctx?.context) return { text: ctx.context, context: true };
  if (s.beat === "takeaway") return { text: C.ui.takeaway, kicker: true };
  return null;
}
/** After the reveal: the room's choice, its effect as chips and its outcome line (in the persona's colour). */
function outcomeHTML(step) {
  const o = optionOf(step, roomChoice(step));
  if (!o) return "";
  return `<div class="outcome-row">${chipsHTML(effectChips(C, o), "big")}</div><p class="outcome pretty">${esc(o.outcome || "")}</p>`;
}
function patchStop(root, s, stop) {
  const ctx = ctxOf(s, stop);
  const step = stepOf(C, s);
  const story = root.querySelector("[data-story]");
  if (story) {
    const st = storyOf(s, stop, ctx);
    story.classList.toggle("solo", s.beat === "listen");
    story.classList.toggle("context", !!st?.context);
    story.classList.toggle("kicker", !!st?.kicker);
    story.textContent = st ? st.text : "";
  }
  const head = root.querySelector("[data-head]");
  if (head) head.textContent = s.beat === "handover" ? `“${stop.handover}”` : s.beat === "takeaway" ? step.text : ["listen", "gather", "look"].includes(s.beat) || !ctx ? "" : ctx.question;
  const after = root.querySelector("[data-after]");
  if (after) {
    let html = "";
    if (ctx?.type === "pulse" && s.beat === "locked") html = esc(ctx.resultLine || "");
    if (ctx?.type === "guess" && s.beat === "reveal") html = esc(ctx.revealNote || "");
    if (movesClock(ctx) && s.beat === "reveal") html = outcomeHTML(ctx);
    if (after.dataset.html !== html) {
      after.dataset.html = html;
      after.innerHTML = html;
    }
  }
  const stat = root.querySelector("[data-status]");
  if (stat) stat.innerHTML = stat.dataset.html = statusHTML(s, stop, ctx) + (sideLayout(ctx, stop) ? "" : tieHTML(s, ctx));
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
  if (sites) sites.classList.toggle("flipped", ctx?.revealSites && s.beat === "reveal");
  const guessed = root.querySelector("[data-guessed]");
  if (guessed) guessed.innerHTML = ctx?.revealSites && s.beat === "reveal" ? guessHTML(stop) : "";
}

/** Compact vote status (Stop 1, nine answers, the travellers): label, clock, answers in. */
function statusHTML(s, stop, ctx) {
  if (!ctx || sideLayout(ctx, stop)) return "";
  if (s.beat === "think") return `<span class="label-lg pcb">${esc(U("thinkLabel"))}</span><span class="mono-lg pcb" data-clock></span>`;
  if (s.beat === "vote" && !S.closed[s.slot]) return `<span class="label-lg pcb"><i class="dot pulse"></i>${esc(U("votingOpen"))}</span><span class="mono-lg pcb" data-clock></span>${live.on ? `<span class="mono-md muted" data-voted></span>` : ""}`;
  if (s.beat === "vote" || s.beat === "locked") return `<span class="label-lg muted">${icon("lock")} ${esc(U("votesLocked"))}</span>${live.on ? `<span class="mono-md muted" data-voted></span>` : ""}`;
  return "";
}
/** A tie (or no votes) on a question that moves the clock: the presenter picks. */
function tieHTML(s, ctx) {
  if (s.beat !== "locked" || !movesClock(ctx) || roomChoice(ctx)) return "";
  const t = tiedIds(ctx);
  return `<p class="tie-note label-lg">${t.length > 1 ? `${esc(C.ui.tieTitle)}: ${t.join(" · ")}. ` : ""}${esc(C.ui.tieNote)}</p>`;
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
    return `<div class="panel-box"><div class="ph"><span class="label-lg muted">${icon("lock")} ${esc(U("votesLocked"))}</span><span class="mono-lg muted">00:00</span></div>${live.on ? `<span class="mono-md" data-voted></span>` : ""}${tieHTML(s, ctx)}</div>`;
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
    return `<div class="card stop sites-look" data-p="crew"><div class="col-main">${crew}<p class="story body-lg pretty" data-story></p><div class="sites big${sites.length === 1 ? " one" : ""}">${cards}</div></div></div>`;
  return `<div class="card stop sites-q" data-p="crew">
    <div class="col-main">${crew}<p class="story body-md pretty" data-story></p><div class="sites${sites.length === 1 ? " one" : ""}">${cards}</div><p class="guessed body-md" data-guessed></p></div>
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

// ------------------------------------------------------------------ results on the answers
function updateResults() {
  const s = scr();
  const stop = stopOf(C, s);
  const step = ctxOf(s, stop);
  const root = current();
  if (!root) return;
  // A tie can be broken while locked: refresh the panel's note
  const panel = root.querySelector("[data-panel]");
  if (panel && s.beat === "locked") {
    const html = panelHTML(s, stop, step, stepOf(C, s));
    if (panel.dataset.html !== html) {
      panel.dataset.html = html;
      panel.innerHTML = html;
    }
  }
  const stat = root.querySelector("[data-status]");
  if (stat && s.beat === "locked" && !sideLayout(step, stop)) {
    const html = statusHTML(s, stop, step) + tieHTML(s, step);
    if (stat.dataset.html !== html) stat.innerHTML = stat.dataset.html = html;
  }
  if (step && isVoteStep(step)) {
    const t = tallyOf(step.id);
    const m = S.manual[step.id] || {};
    const top = AFTER.includes(s.beat) ? (movesClock(step) ? [roomChoice(step)].filter(Boolean) : roomTop(step)) : [];
    const tie = s.beat === "locked" && movesClock(step) && !roomChoice(step) ? tiedIds(step) : [];
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
      el.classList.toggle("tie", tie.length > 1 && tie.includes(id));
      el.classList.toggle("picked", !pre && !t.n && p === 100);
      // After the reveal the chosen answer shows its type (hidden while voting)
      const o = top.includes(id) && movesClock(step) && s.beat === "reveal" ? optionOf(step, id) : null;
      let tag = el.querySelector(".type-tag");
      if (o?.type && !tag) el.querySelector(".opt-top").insertAdjacentHTML("beforeend", `<span class="type-tag label-sm" data-t="${esc(o.type)}">${esc(typeLabel(C, o.type))}</span>`);
      if (!o && tag) tag.remove();
    });
    root.querySelectorAll("[data-voted]").forEach((v) => (v.textContent = U("voted", { n: t.n, total: live.riders })));
  }
  const g = root.querySelector("[data-guessed]");
  if (g && g.innerHTML) g.innerHTML = guessHTML(stop);
}

// ------------------------------------------------------------------ the road: convoy, milestone, route and fuel
const SLOT = 200;
const LEFT = 48;
let roadKey = "";

/** The stop's persona waits by the road from their arrival until they join at the handover. */
function waitingAt(s, stop, joined) {
  const pid = stop?.persona;
  if (!pid || pid === "crew" || joined.includes(pid)) return null;
  return ["arrive", "detour", "listen", "think", "vote", "locked", "reveal", "takeaway", "card"].includes(s.beat) ? pid : null;
}
function rider(pid) {
  const el = document.createElement("div");
  el.className = "rider";
  el.dataset.p = pid;
  // The lead motorcycle carries the trip dashboard: a small clock face (the expected arrival) and the fuel bill
  const dash = pid === "crew" ? `<span class="dash"><span class="dchips"></span>${clockFace(idealMinutes(C), "dclock")}<b class="mono-md dt"></b><i class="dsep"></i>${icon("local_gas_station", "dfuel")}<b class="mono-md df"></b></span>` : "";
  el.innerHTML = `<span class="tagrow"><span class="tag label-sm">${icon(personaIcon(C, pid))}<span></span></span>${dash}</span><span class="bikebox"><i class="shadow"></i>${bike(pid, { beam: pid === "crew" })}<span class="bolts"></span></span>`;
  return el;
}

// ------------------------------------------------------------------ the dashboard on the lead motorcycle
let shown = null; // { minutes, rupees } on the dashboard right now
let dashTimer = null;
function setHands(el, total) {
  el.querySelector(".mh")?.style.setProperty("transform", `rotate(${total * 6}deg)`);
  el.querySelector(".hh")?.style.setProperty("transform", `rotate(${total * 0.5}deg)`);
}
function tween(from, to, ms, fn) {
  if (reduceMotion() || from === to) return fn(to);
  const t0 = performance.now();
  const step = (t) => {
    const f = Math.min(1, (t - t0) / ms);
    fn(Math.round(from + (to - from) * (1 - (1 - f) ** 3)));
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** Move the dashboard to the trip's values; animate (hands sweep, rupees tick, change chips) when asked. */
function updateDash(T, { animate = false, delay = 0 } = {}) {
  const dash = $("#convoy .rider.lead .dash");
  if (!dash) return;
  const now = { minutes: T.minutes, rupees: T.rupees };
  if (shown && shown.minutes === now.minutes && shown.rupees === now.rupees && dash.dataset.ready) return;
  const prev = shown && dash.dataset.ready ? shown : null;
  shown = now;
  clearTimeout(dashTimer);
  const apply = () => {
    dash.dataset.ready = "1";
    const base = idealMinutes(C);
    setHands(dash, base + now.minutes);
    dash.classList.toggle("late", now.minutes > 0);
    const dt = dash.querySelector(".dt"), df = dash.querySelector(".df");
    if (!animate || !prev) {
      dt.textContent = clockText(C, now.minutes);
      df.textContent = rupeeText(now.rupees);
      return;
    }
    tween(prev.minutes, now.minutes, 1200, (m) => (dt.textContent = clockText(C, m)));
    tween(prev.rupees, now.rupees, 1200, (r) => (df.textContent = rupeeText(r)));
    const dm = now.minutes - prev.minutes, dr = now.rupees - prev.rupees;
    const chips = [];
    if (dm) chips.push({ cls: dm < 0 ? "saved" : "added", text: deltaText(C, dm) });
    if (dr) chips.push({ cls: "rupees", text: `${dr > 0 ? "+" : "\u2212"}${rupeeText(Math.abs(dr))}` });
    const box = dash.querySelector(".dchips");
    box.innerHTML = chipsHTML(chips, "float");
    dash.classList.remove("bump");
    void dash.offsetWidth;
    dash.classList.add("bump");
    sound.ok() && dm && sound.tick();
  };
  if (animate && delay && !reduceMotion()) dashTimer = setTimeout(apply, delay);
  else apply();
}

/** Loose bolts as badges on the bikes of the people whose stop planted them. A broken one falls off. */
function renderBolts(s, T, forward) {
  const convoy = $("#convoy");
  const want = new Set(T.loose);
  convoy.querySelectorAll(".boltb").forEach((b) => {
    if (want.has(b.dataset.b) || b.classList.contains("falling")) return;
    if (forward && s.beat === "detour" && s.bolt === b.dataset.b && !reduceMotion()) {
      setTimeout(() => {
        b.classList.add("falling");
        setTimeout(() => b.remove(), 1200);
      }, 1100);
    } else b.remove();
  });
  for (const id of T.loose) {
    if (convoy.querySelector(`.boltb[data-b="${id}"]`)) continue;
    const pid = C.bolts[id].persona;
    const host = convoy.querySelector(`.rider[data-p="${pid}"] .bolts`) || convoy.querySelector(".rider.lead .bolts");
    if (!host) continue;
    host.insertAdjacentHTML("beforeend", `<span class="boltb${forward && s.beat === "reveal" ? " new" : ""}" data-b="${esc(id)}" title="${esc(C.bolts[id].label)}">${nut()}</span>`);
  }
}

function renderRoad(s, stop, forward, T) {
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
    for (const el of convoy.querySelectorAll(".rider")) el.style.transition = "none";
    convoy.classList.remove("roll-in");
    void convoy.offsetWidth;
    convoy.classList.add("roll-in");
    requestAnimationFrame(() => convoy.querySelectorAll(".rider").forEach((el) => (el.style.transition = "")));
  }
  const lead = convoy.querySelector(".rider.lead");
  lead.classList.toggle("rev", s.beat === "fired");
  $("#backdrop").style.setProperty("--par", String(leadX - LEFT));

  // The trip: the dashboard moves with a reveal or a detour (a beat later, so the room sees the cause first)
  const animate = forward && ["reveal", "detour"].includes(s.beat);
  updateDash(T, { animate, delay: s.beat === "detour" ? 900 : 700 });
  renderBolts(s, T, forward);
  // A detour: the convoy stops with a jolt and the DETOUR sign swings in beside the milestone
  const dt = $("#detour");
  dt.classList.toggle("on", s.beat === "detour");
  dt.style.setProperty("--x", `${leadX + 192 + 24 + 150}px`);
  if (s.beat === "detour" && forward && !reduceMotion()) {
    for (const el of [convoy, dt]) {
      el.classList.remove("jolt", "swing");
      void el.offsetWidth;
    }
    convoy.classList.add("jolt");
    dt.classList.add("swing");
    sound.detour();
  }

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
  const fwd = t > from;
  // The reveal needs the room's choice: a tie (or, in Host mode, no pick yet) waits for the presenter
  if (fwd && s.beat === "reveal" && movesClock(stepOf(C, s)) && !roomChoice(stepOf(C, s))) {
    const tie = tiedIds(stepOf(C, s));
    toast(tie.length > 1 ? `Tie between ${tie.join(" and ")}. Pick the room's answer: click it or press its letter.` : "Pick the room's answer first: click it or press its letter.");
    return;
  }
  S.i = t;
  if (s.beat === "think") S.think = fwd ? { key: s.key, endsAt: Date.now() + cfg("thinkSeconds", 15) * 1000, duration: cfg("thinkSeconds", 15) } : { key: s.key, done: true, duration: cfg("thinkSeconds", 15) };
  if (s.beat === "vote") {
    if (fwd && S.vote.slot !== s.slot && !S.closed[s.slot]) startVote(s.slot);
    if (!fwd) delete S.final[s.slot]; // back from LOCK: the result comes off; votes stay closed until reopened
  }
  if (s.beat === "locked" && !S.final[s.slot]) lockVotes(s.slot);
  if (s.beat === "reveal") sound.reveal();
  if (s.beat === "fired") sound.roar();
  // The engine rev plays once: the kick-start ("Fire it up")
  commit();
  if (s.transient) {
    busy = true;
    const ms = s.beat === "fired" ? FIRE_MS : cfg("rideMs", 3000);
    setTimeout(() => {
      busy = false;
      if (S.i === t) go(nextFrom(t + 1));
    }, reduceMotion() ? 300 : ms);
  }
}
function next() {
  if (busy || modalOpen) return;
  go(nextFrom(S.i + 1));
}
function back() {
  if (busy || modalOpen || S.i === 0) return;
  let t = S.i - 1;
  while (t > 0 && (SCREENS[t].transient || skipAt(t))) t--;
  go(t);
}
/** Skip the petrol pump, unless a loose bolt is due to break there. */
function canSkip() {
  const t = pumpSkip(C, SCREENS, S.i);
  if (t == null) return null;
  const pump = C.stops.find((x) => x.skippable);
  return trip().loose.some((id) => C.bolts[id].breaksAt === pump?.id) ? null : t;
}
function skip() {
  const t = canSkip();
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
  shown = null;
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
  if (canSkip() != null) ctl.push(b("skip", "skip_next", "Skip the pump"));

  const flags = [];
  if (lowTurnout()) flags.push("Low turnout. Ask the room to join.");
  if (live.on && isPrivateHost(new URL(voteUrl()).hostname) && ["lobby", "vote"].includes(s.beat)) flags.push("Phones can't reach localhost. Open the projector from this computer's Wi-Fi address instead.");
  if (!sound.muted && !(sound.ctx && sound.ctx.state === "running") && ["cold", "title", "ignite"].includes(s.beat)) flags.push("Sound is waiting: press any key once.");
  if (voting && !live.on && step.type !== "pulse") flags.push("Click the room's answer on the screen (or A–D).");
  if (s.beat === "locked" && movesClock(step) && !roomChoice(step) && live.on) flags.push(tiedIds(step).length > 1 ? `Tie: ${tiedIds(step).join(" · ")}. Click the room's answer (or press its letter).` : "No votes yet. Click the room's answer (or press its letter).");
  const toastOn = lastToast.text && Date.now() - lastToast.at < 6000;

  const ph = ALL_PH();
  const here = new Set(placeholdersOf(C, s).map((x) => x.what));
  const core = step?.core || "";
  const note = step?.note || (["cold", "title"].includes(s.beat) ? C.coldOpen.note : ["crew", "fact", "crewClose"].includes(s.beat) ? C.crew.note : s.beat === "ignite" ? C.ignition.note : s.beat === "rules" ? C.rules.note : "");
  const panel =
    dockPanel === "notes"
      ? `<div class="d-panel">${core ? `<p>${esc(core)}</p>` : ""}${note ? `<p class="muted">${esc(note)}</p>` : ""}${step?.revealNote && ["vote", "locked"].includes(s.beat) ? `<p class="muted"><b>Reveal:</b> ${esc(step.revealNote)}</p>` : ""}${stop?.steps.some((x) => x.sites) ? `<p>${stop.steps.find((x) => x.sites).sites.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${icon("open_in_new")} ${esc(x.title)}</a>`).join(" ")}</p>` : ""}${!core && !note ? `<p class="muted">No notes for this screen.</p>` : ""}</div>`
      : dockPanel === "todo"
        ? `<div class="d-panel"><b>Placeholders (hidden from the audience)</b><ul>${ph.map((x) => `<li class="${here.has(x.what) ? "here" : ""}"><span>${esc(x.what)}</span><span class="mono">screen ${x.i + 1}</span></li>`).join("")}</ul><p class="muted">Edit public/content/en.json, then reload.</p></div>`
        : "";
  const html = `${toastOn ? `<p class="d-toast">${esc(lastToast.text)}</p>` : ""}${flags.map((f) => `<p class="d-flag">${esc(f)}</p>`).join("")}${panel}
    <div class="d-bar">
      ${b("back", "arrow_back", "", "", "Back")}
      <button type="button" class="d-btn go" data-cmd="next" ${busy || nextFrom(S.i + 1) > last ? "disabled" : ""}>${icon("arrow_forward")}<span>${esc(nextLabel(SCREENS, S.i, skipAt))}</span></button>
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
  if (scr().beat === "look" && !scr().focus && e.target.closest(".site")) return next();
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
    case "pick": return enterPick(Number(c.arg));
    case "mute": return toggleMute();
    case "mode":
      live.manual = live.on; // the presenter chose Host mode: don't switch back by itself
      return live.on ? fallbackToHost("Host mode: enter the room's answers by hand.") : enableLive(false);
    case "returnLive": live.manual = false; return enableLive(false);
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
  if (live.on && document.visibilityState === "visible" && now - live.lastOk > LOST_AFTER_MS) return fallbackToHost("Lost the live server for 5 seconds. Switched to Host mode; answers so far are kept.");
  if (!live.on && !live.hostOnly && S && wantLive() && now - lastHealth > 3000) {
    lastHealth = now;
    serverUp(2000)
      .then((ok) => {
        if (ok && live.lost && !live.manual) return enableLive(true); // it dropped by itself: go back to Live by itself
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (live.on) {
    live.lastOk = Date.now();
    if (!live.ws || live.ws.readyState > 1) connectWS();
  } else lastHealth = 0; // check the server straight away
});
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
    S.closed = {};
    S.final = {};
    S.tallies = {};
    S.manual = {};
    S.vote = { slot: null };
    S.think = { key: null };
  }
  // Tallies only for the step on screen, and only until its votes lock
  if (st.tally && st.slot === scr().slot && !S.final[st.slot]) S.tallies[st.slot] = st.tally;
  if (typeof st.riders === "number") live.riders = st.riders;
  save();
  updateResults();
  updatePlayers();
}
function desired() {
  const s = scr();
  const ctx = ctxOf(s, stopOf(C, s));
  // Phones show the room's choice and its effect after the reveal
  const pick = ["reveal", "takeaway"].includes(s.beat) && movesClock(ctx) ? roomChoice(ctx) : null;
  return { slot: s.slot, phase: phaseOf(s, !!S.closed[s.slot] || (s.beat === "vote" && S.vote.slot !== s.slot)), pick };
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
      const r = await adminCall({ action: "set", slot: want.slot, phase: want.phase, seq: want.seq, vote, pick: want.pick });
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
  if (scr().focus && (k === "ArrowDown" || k === "ArrowUp")) return scrollSite(k === "ArrowDown" ? 320 : -320), true;
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
