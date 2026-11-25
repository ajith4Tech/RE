/* The Ride — projector. "The Highway" edition.
 * The route is 7 stops (content/en.json → stops), each an ordered list of steps (→ route).
 * The bike rides, the km flips and the persona is introduced once per stop, on arrival;
 * steps within a stop only change the main panel.
 * Phases: lobby → arrive (a stop) → per step: card | hurdle → ask → reveal (→ sub-steps) | info → … → summary
 * Everything is saved in localStorage, so a reload or a live AI demo resumes exactly.
 * The moderator view follows via BroadcastChannel (same laptop, offline) and the server.
 */
import { LANGUAGES, langMeta, tr, gapsFor, choicesFor, expandRoute } from "./i18n.js";
import { buildBand, emblem, PIT_ICONS } from "./scenery.js";
import { isProfane } from "./profanity.js";

const $ = (s) => document.querySelector(s);
const STORE = "ride.state.v4"; // v4: steps grouped into stops, vote slots named by step id
const PIN_KEY = "ride.pin";
const RIDE_MS = 2600;
const LETTERS = "ABCDEFGH";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("the-ride") : null;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let en, R, last, band, STOPS;
const stats = { arrivals: [], screens: [] }; // for the tests: every arrival (stop, km) and every screen shown, in order
const FILES = {}; // language code → translation file
let S;
let busy = false;
let armed = 0;
let sceneKey = "";
const live = { on: false, ws: null, wsOpen: false, pollTimer: null, pingTimer: null, reconnectTimer: null, fails: 0, chain: Promise.resolve(), lastOk: 0, lost: false, canReturn: false, riders: 0 };
const LOST_AFTER_MS = 5000; // Live server silent this long: switch to Host Mode
const LOW_TURNOUT = { votes: 10, afterMs: 45000 }; // fewer votes than this after this long: offer Host Mode entry
const openedAt = {}; // slot → when voting opened (this session)

const fresh = (mode = "host") => ({
  i: 0, sub: 0, phase: "lobby",
  manual: {}, final: {}, closed: {}, tallies: {}, stamps: {},
  words: [], liveWords: [], pending: 0, languages: 0, hurdle: 0,
  timer: { endsAt: null, duration: 60, label: "" },
  mode, round: null,
});

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (p) => String(p || "").split(",")[0];
const cfg = (k, d) => en?.config?.[k] ?? d;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : "");
const item = (i = S.i) => R[i];
// The steps inside one route item. Viewpoint: one per showcase; checkpost: one per round.
// Question: the question itself, then the reveal of any viewpoint held until after it
// ("revealAfter"), then its mirror poll if it has one.
function stepsOf(i) {
  const it = R[i];
  if (it.kind === "pitstop" && it.pitType === "viewpoint") return it.showcases.map((_, k) => ({ t: "show", k }));
  if (it.kind === "pitstop" && it.pitType === "checkpost") return it.rounds.map((_, k) => ({ t: "round", k }));
  const st = [{ t: "main" }];
  if (it.kind !== "question") return st;
  if (it.mirror) st.push({ t: "mirror" });
  R.forEach((v, vi) => v.revealAfter === it.id && v.showcases?.forEach((_, k) => st.push({ t: "held", vi, k })));
  return st;
}
const stepOf = (i = S.i, sub = S.sub) => stepsOf(i)[sub] || { t: "main" };
const hasSubs = (it) => stepsOf(R.indexOf(it)).length > 1;
const subCount = (it) => stepsOf(R.indexOf(it)).length;
/** Vote slot, named by step id: "q3", "p4.1" (viewpoint showcase / checkpost round), "q1.m" (mirror poll).
 *  A held viewpoint reveal uses the viewpoint's own slot ("p1.0"). Phones and the server key votes on it. */
function slotOf(i = S.i, sub = S.sub) {
  const st = stepOf(i, sub);
  if (st.t === "held") return `${R[st.vi].id}.${st.k}`;
  if (st.t === "mirror") return `${R[i].id}.m`;
  return R[i].kind === "pitstop" && hasSubs(R[i]) ? `${R[i].id}.${sub}` : R[i].id;
}
const indexOfSlot = (slot) => R.findIndex((r) => r.id === String(slot).split(".")[0]);
/** A stable name for the screen on show (for the tests' forward walk). */
function screenId() {
  if (["lobby", "summary"].includes(S.phase)) return S.phase;
  if (S.phase === "arrive") return `arrive:${item().stopId}`;
  const st = stepOf();
  return st.t === "held" ? `${item().id}>reveal:${slotOf()}` : st.t === "mirror" ? `${item().id}.mirror` : hasSubs(item()) ? `${item().id}.${S.sub}` : item().id;
}
const stopCount = () => STOPS.length;
const heldHere = (it = item()) => it.pitType === "viewpoint" && !!it.revealAfter && stepOf().t !== "held";
const qLabel = (id) => { const k = R.findIndex((r) => r.id === id); return k < 0 ? id : `Q${qNumber(k)}`; };
const isPrivateHost = (h) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
const tallyOf = (slot) => S.tallies[slot] || { n: 0, counts: {}, pos: {}, nums: {} };
const qNumber = (i) => R.slice(0, i + 1).filter((r) => r.kind === "question").length;
const totalQ = () => R.filter((r) => r.kind === "question").length;
const isScoredQ = (it) => it.kind === "question" && it.scored;
const hasQuestion = (it) => it.kind === "question" || ["petrol", "landslide", "viewpoint", "checkpost"].includes(it.pitType);
const voteUrl = () => cfg("voteUrl", "") || `${location.origin}/v`;
const shortUrl = () => voteUrl().replace(/^https?:\/\//, "");

function fit() {
  document.documentElement.style.setProperty("--scale", Math.min(innerWidth / 1920, innerHeight / 1080));
}
addEventListener("resize", fit);
fit();

/** A regional-language line for a content path. Alternates between the stop's languages. */
function rl(path, langs, extra = "") {
  const avail = (langs || []).filter((c) => c !== "en" && tr(FILES[c], path));
  if (!avail.length) return "";
  const c = avail[0];
  const m = langMeta(c);
  const tag = avail.length > 1 || extra.includes("cycle") ? `<span class="rl-tag">${esc(m.name)}</span>` : "";
  return `<div class="rl ${extra}" data-path="${esc(path)}" data-langs="${avail.join(",")}" data-k="0" lang="${c}" dir="${m.dir}">${tag}<span class="rl-text">${esc(tr(FILES[c], path))}</span></div>`;
}
// ?rl=<code> forces every stop's regional line into one language (used to test the longest translations).
const RL_OVERRIDE = new URLSearchParams(location.search).get("rl");
const regionLangs = (it = item()) => (RL_OVERRIDE ? [RL_OVERRIDE] : (it.languages || []).filter((c) => c !== "en"));

// Rotate regional lines: two-language stops every 6 s; the final question cycles through the audience languages every 4 s.
let lastAlt = 0;
let lastCycle = 0;
function rotateRegional(now) {
  const doAlt = now - lastAlt >= cfg("regionalAlternateSeconds", 6) * 1000;
  const doCyc = now - lastCycle >= cfg("finalCycleSeconds", 4) * 1000;
  if (doAlt) lastAlt = now;
  if (doCyc) lastCycle = now;
  if (!doAlt && !doCyc) return;
  document.querySelectorAll(".rl").forEach((el) => {
    const isCycle = el.classList.contains("cycle");
    if ((isCycle && !doCyc) || (!isCycle && !doAlt)) return;
    const langs = el.dataset.langs.split(",");
    if (langs.length < 2) return;
    const k = (Number(el.dataset.k) + 1) % langs.length;
    const c = langs[k];
    const m = langMeta(c);
    const swap = () => {
      el.dataset.k = k;
      el.lang = c;
      el.dir = m.dir;
      el.querySelector(".rl-text").textContent = tr(FILES[c], el.dataset.path);
      const tag = el.querySelector(".rl-tag");
      if (tag) tag.textContent = m.name;
      el.classList.remove("fade");
    };
    if (reduceMotion()) return swap();
    el.classList.add("fade");
    setTimeout(swap, 350);
  });
}

// ------------------------------------------------------------------ results per format
function majority(counts, ids, best) {
  const max = Math.max(0, ...ids.map((id) => counts[id] || 0));
  if (!max) return null;
  const top = ids.filter((id) => (counts[id] || 0) === max);
  return best && top.includes(best) ? best : top[0]; // a tie that includes the right answer counts as right
}
const avgPos = (t, id) => (t.counts[id] ? t.pos[id] / t.counts[id] : 99);

function resultFor(i, sub = 0) {
  const it = R[i];
  const step = stepOf(i, sub);
  if (step.t === "held") return resultFor(step.vi, step.k);
  const slot = slotOf(i, sub);
  const m = S.manual[slot] || {};
  const t = tallyOf(slot);
  const r = { has: false, correct: null, delta: 0, text: "" };
  const ids = (list) => list.map((o) => o.id);
  if (step.t === "mirror") {
    // A mirror poll: where the room is. No right answer, no fuel.
    r.choice = m.choice ?? (t.n ? majority(t.counts, ids(it.mirror.options)) : null);
    r.has = !!r.choice;
    if (r.has) r.text = `the room is at “${it.mirror.options.find((o) => o.id === r.choice).text}”`;
    return r;
  }
  if (it.kind === "question") {
    switch (it.type) {
      case "choose":
      case "tapstep":
      case "checkpoint": {
        const choices = choicesFor(it);
        r.choice = m.choice ?? (t.n ? majority(t.counts, ids(choices), it.answer) : null);
        if (r.choice) {
          r.has = true;
          r.correct = r.choice === it.answer;
          const k = choices.findIndex((c) => c.id === r.choice);
          r.text = it.type === "tapstep" ? `the room picked step ${k + 1}` : it.type === "checkpoint" ? `the room put the human check before “${choices[k].text}”` : `the room chose ${LETTERS[k]}`;
        }
        break;
      }
      case "pickn": {
        let picks = m.picks?.length ? m.picks : null;
        if (!picks && t.n) {
          const sorted = ids(it.items).sort((a, b) => (t.counts[b] || 0) - (t.counts[a] || 0) || (it.decoys.includes(a) ? 1 : 0) - (it.decoys.includes(b) ? 1 : 0));
          picks = sorted.slice(0, it.n);
        }
        if (picks) {
          r.has = true;
          r.picks = picks;
          const bad = picks.filter((p) => it.decoys.includes(p));
          r.correct = !bad.length;
          r.text = bad.length ? `a decoy made the room's top ${it.n}` : `no decoys in the room's top ${it.n}`;
        }
        break;
      }
      case "rank": {
        let order = m.order?.length === it.items.length ? m.order : null;
        if (!order && t.n) order = ids(it.items).sort((a, b) => avgPos(t, a) - avgPos(t, b));
        if (order) {
          r.has = true;
          r.order = order;
          r.correct = order[0] === it.firstItem && order[order.length - 1] === it.lastItem;
          r.text = r.correct ? "the room put the right ones first and last" : "the room's order was off at the ends";
        }
        break;
      }
      case "match": {
        let map = m.match && Object.keys(m.match).length ? m.match : null;
        if (!map && t.n) {
          map = {};
          for (const x of it.items) {
            const best = majority(Object.fromEntries(it.buckets.map((b) => [b.id, t.counts[`${x.id}:${b.id}`] || 0])), ids(it.buckets), it.answers[x.id]);
            if (best) map[x.id] = best;
          }
        }
        if (map) r.map = map;
        if (map && it.keyMatch.every((k) => map[k])) {
          r.has = true;
          r.correct = it.keyMatch.every((k) => map[k] === it.answers[k]);
          r.text = r.correct ? "the room put the key items in the right buckets" : "the room put a key item in the wrong bucket";
        }
        break;
      }
    }
    if (!it.scored) r.correct = null;
    return r;
  }
  switch (it.pitType) {
    case "petrol": {
      const share = m.pct != null ? m.pct / 100 : t.n ? (t.counts.yes || 0) / t.n : null;
      if (share != null) {
        r.has = true;
        r.share = share;
        r.delta = Math.round((it.fuel.shareYes || 20) * share);
        r.text = `${Math.round(share * 100)}% said yes`;
      }
      break;
    }
    case "landslide":
    case "checkpost": {
      const opts = it.pitType === "checkpost" ? it.options : it.poll.options;
      const answer = it.pitType === "checkpost" ? it.rounds[sub].answer : it.answer;
      r.choice = m.choice ?? (t.n ? majority(t.counts, ids(opts), answer) : null);
      r.has = !!r.choice;
      r.correct = r.has ? r.choice === answer : null;
      r.delta = it.pitType === "landslide" ? (r.correct ? it.fuel.right : it.fuel.wrong) : r.correct ? it.fuel.perRight : 0;
      r.text = r.has ? `the room chose “${opts.find((o) => o.id === r.choice).text}”` : "";
      break;
    }
    case "mechanic":
      r.delta = it.fuel.add;
      break;
  }
  return r;
}

function fuel() {
  let f = 100;
  const capF = cfg("fuelCap", 100);
  R.forEach((it, i) => {
    for (let s = 0; s < subCount(it); s++) {
      const fin = S.final[slotOf(i, s)];
      if (!fin) continue;
      if (it.kind === "question") {
        if (s === 0 && it.scored && fin.correct === false) f -= cfg("fuelPenalty", 15);
      } else if (it.kind === "pitstop") f += fin.delta || 0;
      f = Math.max(0, Math.min(capF, f));
    }
  });
  return Math.round(f);
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
    en = await (await fetch("content/en.json", { cache: "no-store" })).json();
  } catch {
    $("#scene").innerHTML = `<div class="loadbox">Couldn't load <code>content/en.json</code>. Start the game with <code>npm run host</code>.</div>`;
    return;
  }
  R = expandRoute(en);
  STOPS = en.stops || R.map((r, k) => ({ id: r.id, place: r.place, km: r.km, landscape: r.landscape, steps: [r.id] }));
  last = R.length - 1;
  await Promise.all(
    LANGUAGES.filter((l) => l.code !== "en").map(async (l) => {
      try { FILES[l.code] = await (await fetch(`content/${l.code}.json`, { cache: "no-store" })).json(); } catch {}
    })
  );
  try {
    await Promise.all(["800 40px Signage", "700 40px Painted", "700 30px Atkinson", "30px Atkinson"].map((f) => document.fonts.load(f)));
  } catch {}
  band = buildBand($("#band"), STOPS.map((st) => ({ kind: "question", ...st })), short, $("#bikeLayerSvg")); // one milestone per stop
  S = loadState();
  $("#logSlots").innerHTML = R.map((it, i) => (it.kind === "pitstop" ? `<div class="slot" data-i="${i}" title="${esc(it.place)}"></div>` : "")).join("");
  renderLog(null);
  render();
  setInterval(tick, 250);
  // Live Vote is the default. ?mode=host starts offline; without a reachable server it falls back to Host Mode by itself.
  const wantLive = new URLSearchParams(location.search).get("mode") !== "host";
  S.mode = "host";
  if (wantLive && location.protocol.startsWith("http")) enableLive(true);
  setInterval(watchdog, 1000);
  announce();
}

// ------------------------------------------------------------------ HUD
function setKm(n) {
  const s = String(Math.round(n)).padStart(4, " ");
  const box = $("#odo");
  if (box.children.length !== s.length) box.innerHTML = [...s].map(() => `<span class="flap"></span>`).join("");
  [...s].forEach((ch, k) => {
    const el = box.children[k];
    if (el.textContent !== ch.trim()) {
      el.textContent = ch.trim();
      if (!reduceMotion()) {
        el.classList.remove("flip");
        void el.offsetWidth;
        el.classList.add("flip");
      }
    }
  });
  $("#odo").setAttribute("aria-label", `${Math.round(n)} km`);
}

function renderFuel() {
  const f = fuel();
  $("#fuelPct").textContent = `${f}%`;
  $("#needle").style.transform = `rotate(${-90 + (180 * f) / 100}deg)`;
}

function flashFuel(before, after) {
  if (before === after) return;
  const d = $("#fuelDelta");
  d.textContent = `${after > before ? "+" : "−"}${Math.abs(after - before)}%`;
  d.className = `fuel-delta ${after > before ? "up" : ""}`;
  void d.offsetWidth;
  d.classList.add("show");
}

const stampHTML = (it, i, thump) => `<div class="stamp ${thump && !reduceMotion() ? "thump" : ""}" style="--rot:${((i * 37) % 24) - 12}deg">${esc(it.stamp)}</div>`;
function renderLog(thumpI) {
  document.querySelectorAll("#logSlots .slot").forEach((el) => {
    const i = Number(el.dataset.i);
    if (S.stamps[i]) {
      if (!el.firstChild || thumpI === i) el.innerHTML = stampHTML(R[i], i, thumpI === i);
    } else el.innerHTML = "";
  });
}
function stamp(i) {
  if (S.stamps[i]) return;
  S.stamps[i] = true;
  renderLog(i);
}

// ------------------------------------------------------------------ render
function nearestPlace(i) {
  for (let k = i; k >= 0; k--) if (R[k].kind === "question") return R[k].place;
  return (R.find((r) => r.kind === "question") || R[0]).place;
}

function render() {
  const it = item();
  $("#hudKind").textContent =
    S.phase === "lobby" ? "Lobby · waiting for riders" : S.phase === "summary" ? "Journey's end" :
    S.phase === "arrive" ? `Stop ${it.stopIndex + 1} of ${stopCount()} · arriving` :
    `Stop ${it.stopIndex + 1} of ${stopCount()} · Step ${it.stepIndex + 1} of ${it.stepCount}${it.kind === "question" ? ` · Question ${qNumber(S.i)} of ${totalQ()}` : ""}`;
  $("#hudPlace").textContent = it.milestone || short(it.stopPlace || it.place);
  if (!busy) {
    setKm(it.km);
    band.setStop(it.stopIndex ?? S.i);
  }
  renderFuel();
  const shortBand = ["ask", "reveal", "summary", "hurdle"].includes(S.phase) || (S.phase === "info" && it.pitType === "mechanic") || (S.phase === "card" && it.kind === "card");
  $("#stage").classList.toggle("band-short", shortBand && !busy);
  $("#stage").classList.toggle("band-tall", !shortBand || busy);

  const key = [S.i, S.sub, S.phase, live.on, S.hurdle].join("|");
  if (key !== sceneKey) {
    sceneKey = key;
    $("#scene").innerHTML =
      S.phase === "lobby" ? lobbyHTML() :
      S.phase === "summary" ? summaryHTML() :
      S.phase === "arrive" ? arriveQ(it) :
      S.phase === "card" ? (it.kind === "intro" ? introHTML() : cardHTML(it)) :
      it.kind === "question" ? askQ(it) :
      pitHTML(it);
    if (S.phase === "lobby" && live.on) makeQR($("#qrBig"), voteUrl());
    if (!stats.screens.length || stats.screens[stats.screens.length - 1] !== screenId()) stats.screens.push(screenId());
    jitterPaint();
    lastAlt = lastCycle = performance.now();
  }
  updateResults();
  if (S.phase === "lobby") setCount($("#ridersCount"), live.riders);
  fitScene();
  updateQR();
  updateBar();
  renderTimer();
}

/** Fit: drop option translations first, then shrink the answers, then the left column. The question never shrinks. */
function fitScene() {
  const scene = $("#scene");
  const inner = scene.firstElementChild;
  if (!inner) return;
  const over = () => inner.scrollHeight > scene.clientHeight + 1 || inner.getBoundingClientRect().bottom > scene.getBoundingClientRect().bottom + 1;
  const answers = inner.querySelector(".answers");
  const left = inner.querySelector(".ask-left");
  inner.classList.remove("compact");
  if (answers) answers.style.zoom = "";
  if (left) left.style.zoom = "";
  inner.querySelectorAll(".explain, .infocard").forEach((e) => (e.style.zoom = ""));
  if (!over()) return;
  inner.classList.add("compact");
  let z = 1;
  while (answers && over() && z > 0.7) answers.style.zoom = (z -= 0.04).toFixed(2);
  let z2 = 1;
  while (left && over() && z2 > 0.76) left.style.zoom = (z2 -= 0.04).toFixed(2);
  // Last resort, so nothing reaches the road band and the rider: shrink the reveal box (and an info card's
  // table and text), then the answers a little further. The question itself still never shrinks.
  const extra = inner.querySelector(".explain, .infocard");
  let z3 = 1;
  while (extra && over() && z3 > 0.76) extra.style.zoom = (z3 -= 0.04).toFixed(2);
  while (answers && over() && z > 0.6) answers.style.zoom = (z -= 0.04).toFixed(2);
}

// The road band animates between tall and short; refit once the scene has its final height.
document.getElementById("scene").addEventListener("transitionend", (e) => {
  if (e.target.id === "scene" && e.propertyName === "bottom") fitScene();
});

function jitterPaint() {
  document.querySelectorAll(".board-text:not([data-j])").forEach((el) => {
    el.dataset.j = "1";
    el.innerHTML = el.textContent
      .split(" ")
      .map((w, k) => `<span class="w" style="--r:${((k * 53) % 5) - 2}deg;--y:${((k * 31) % 5) - 2}px">${esc(w)}</span>`)
      .join(" ");
  });
}

// ------------------------------------------------------------------ scenes
/** Lobby: before the ride starts. Big QR, short URL, a live "riders joined" counter, the language hint. */
function lobbyHTML() {
  if (!live.on)
    return `<div class="intro lobby"><div class="signboard enter"><h1>${esc(en.title)}</h1><h2>${esc(en.subtitle)}</h2>
      <p>Hands up at every stop.</p><div class="cta">Press <kbd>→</kbd> to start.</div></div></div>`;
  return `<div class="intro lobby">
    <div class="signboard enter">
      <h1>${esc(en.title)}</h1>
      <h2>${esc(en.subtitle)}</h2>
      <p>Scan the code to ride along. Pick your language on your phone: 11 languages, or type your own.</p>
      <div class="riders"><div class="flapcount" id="ridersCount"><span class="flaps"></span><b>riders joined</b></div></div>
    </div>
    <div class="qr-panel enter-2"><div class="qr" id="qrBig"></div><b>Scan to ride along</b><span>${esc(shortUrl())}</span></div></div>`;
}
/** The intro card: the first step at Bengaluru. */
function introHTML() {
  return `<div class="intro">
    <div class="signboard enter">
      <h1>${esc(en.title)}</h1>
      <h2>${esc(en.subtitle)}</h2>
      <p>${esc(en.intro)}</p>
      ${rl("intro", ["kn"])}
    </div></div>`;
}

function tagHTML(it, size = 150, withVoice = false) {
  return `<div class="tag grain enter">
    <div class="tag-grid"><div class="pic">${emblem(it.emblem, size, it.id)}</div>
    <div><div class="tag-name">${esc(it.personaName)}</div>${it.role ? `<div class="tag-role">${esc(it.role)}</div>` : ""}${it.orgType ? `<div class="tag-org">${esc(it.orgType)}</div>` : ""}</div></div>
    ${withVoice && it.voice ? `<div class="tag-voice">“${esc(it.voice)}”</div>` : ""}</div>`;
}
const shiftHTML = (it) => (it.shift ? `<div class="shift enter"><b>SHIFT</b><span>${esc(it.shift)}</span></div>` : "");
const slipHTML = (it, cls = "") => (it.scenario ? `<div class="slip grain ${cls}">${esc(it.scenario)}</div>` : "");

/** Arrival at a stop (once per stop): milestone, km, welcome, persona and voice line. */
function arriveQ(it) {
  const p = `stops.${it.stopId}`;
  const welcomes = regionLangs(it)
    .filter((c) => tr(FILES[c], `${p}.welcome`))
    .map((c) => `<div class="stone-welcome" lang="${c}" dir="${langMeta(c).dir}">${esc(tr(FILES[c], `${p}.welcome`))}</div>`)
    .join("");
  return `<div class="arrive">
    <div class="stone grain enter"><div class="stone-top"><div class="stone-place ${(it.milestone || "").length > 12 ? "long" : ""}">${esc(it.milestone || short(it.stopPlace))}</div></div>
      <div class="stone-km">${it.km.toLocaleString("en-IN")} <small>km</small></div>${welcomes}<div class="stone-en">${esc(it.welcome)}</div></div>
    <div class="arrive-right">${tagHTML(it, 190, true)}</div></div>`;
}

function askQ(it) {
  const step = stepOf();
  if (step.t === "held") return viewpointHTML(R[step.vi], step.k, "reveal", `Answers from the viewpoint, revealed after ${qLabel(it.id)}`);
  if (step.t === "mirror") return mirrorHTML(it);
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  if (S.phase === "hurdle") return `<div class="ask"><div class="ask-left">${tagHTML(it, 120)}${slipHTML(it)}</div>
    <div class="ask-main">${shiftHTML(it)}${hurdlesHTML(it, S.hurdle, true)}</div></div>`;
  const isFinal = S.i === last;
  const cycleLangs = (cfg("finalCycleLanguages", []) || []).filter((c) => c !== "en");
  const qLine = isFinal ? rl(`${p}.question`, cycleLangs, "cycle") : rl(`${p}.question`, L);
  const board =
    it.type === "dualcloud"
      ? `<div class="signboard dual-q enter-2">${it.parts.map((pt) => `<div class="half ${esc(pt.color)}"><span class="part-title">${esc(pt.title)}</span><div class="q-en">${esc(pt.text)}</div>${isFinal ? rl(`${p}.parts.${pt.id}`, cycleLangs, "cycle") : rl(`${p}.parts.${pt.id}`, L)}</div>`).join("")}</div>`
      : `<div class="signboard enter-2"><div class="q-en">${esc(it.question)}</div>${qLine}</div>`;
  return `<div class="ask ${S.phase === "reveal" ? "revealed" : ""} ${it.type === "dualcloud" ? "dual" : ""}">
    <div class="ask-left">${tagHTML(it, 120)}${slipHTML(it)}</div>
    <div class="ask-main">
      ${shiftHTML(it)}
      ${it.hurdles?.length ? hurdlesHTML(it, it.hurdles.length, false) : ""}
      ${board}
      <div class="answers enter-3">${it.type === "dualcloud" && S.phase !== "reveal" ? waitHTML() : ""}${answersHTML(it, p, L)}${it.type !== "dualcloud" && S.phase !== "reveal" ? waitHTML() : ""}</div>
      ${revealHTML(it, p, L)}
    </div></div>`;
}

/** Hurdle signs (e.g. Q5): one more slides in with each Next press before voting opens. */
function hurdlesHTML(it, shown, big) {
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  return `<div class="hurdles ${big ? "big" : "small"}">${it.hurdles
    .slice(0, shown)
    .map((h, k) => `<div class="hurdle ${big && k === shown - 1 ? "slide" : ""}"><span class="hz" aria-hidden="true">!</span><div><div class="en">${esc(h)}</div>${big ? rl(`${p}.hurdles.${k}`, L) : ""}</div></div>`)
    .join("")}</div>`;
}

/** Mirror poll after a question: no right answer. With compareWith it shows "Today vs. in 6 months" on the reveal. */
function mirrorHTML(it) {
  const mi = it.mirror;
  const p = `route.${it.id}.mirror`;
  const L = regionLangs(it);
  const rev = S.phase === "reveal";
  const body = rev && mi.compareWith ? compareHTML(it) : `<div class="dsigns ${gridCls(mi.options.length)}">${mi.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.options.${o.id}`, L)).join("")}</div>${rev ? "" : waitHTML()}`;
  return `<div class="ask ${rev ? "revealed" : ""}">
    <div class="ask-left">${tagHTML(it, 120)}</div>
    <div class="ask-main">
      <div class="shift enter"><b>MIRROR</b><span>${mi.compareWith ? "Today vs. in 6 months" : "No right answer: where is the room today?"}</span></div>
      <div class="signboard enter-2"><div class="q-en">${esc(mi.question)}</div>${rl(`${p}.question`, L)}</div>
      <div class="answers enter-3">${body}</div>
      ${rev && it.type === "dualcloud" ? `<div class="signboard final-sign"><div class="q-en">${esc(it.reveal)}</div>${rl(`route.${it.id}.reveal`, L)}</div>` : ""}
    </div></div>`;
}
function shareOf(slot, options) {
  const t = tallyOf(slot);
  const pick = S.manual[slot]?.choice;
  return Object.fromEntries(options.map((o) => [o.id, t.n ? pct(t.counts[o.id] || 0, t.n) : pick ? (pick === o.id ? 100 : 0) : null]));
}
function compareHTML(it) {
  const mi = it.mirror;
  const ci = R.findIndex((r) => r.id === mi.compareWith);
  const before = ci >= 0 && R[ci].mirror ? shareOf(`${ci}.m`, mi.options) : {};
  const now = shareOf(slotOf(), mi.options);
  const cell = (v) => `<div class="cmp-cell" style="--p:${v ?? 0}%"><i></i><b>${v == null ? "–" : `${v}%`}</b></div>`;
  return `<div class="compare"><div></div><div class="cmp-h">Today <small>(${esc(qLabel(mi.compareWith))})</small></div><div class="cmp-h">In 6 months</div>
    ${mi.options.map((o, k) => `<div class="cmp-label"><span class="key">${LETTERS[k]}</span>${esc(o.text)}</div>${cell(before[o.id])}${cell(now[o.id])}`).join("")}</div>`;
}

/** Info card: a roadside board, an optional two-column table and an optional link. No vote. */
function cardHTML(it) {
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  const link = it.link ? (it.link.url ? `<a class="show-link" href="${esc(it.link.url)}" target="_blank" rel="noopener">${esc(it.link.label || "Open the link")} ↗</a>` : `<div class="card-note">${esc(it.link.label || "Link to come")}</div>`) : "";
  return `<div class="pit card-pit"><div class="board viewpoint grain enter infocard"><div class="board-kind">Roadside info</div>
    <div class="board-text">${esc(it.title)}</div>${rl(`${p}.title`, L)}
    ${it.rows ? `<table class="token-table enter-2">${it.rows.map((r) => `<tr><td>${esc(r.from)}</td><td class="arr" aria-hidden="true">→</td><td class="tok">${esc(r.to)}</td></tr>`).join("")}</table>` : ""}
    <div class="card-text">${esc(it.text)}${rl(`${p}.text`, L)}</div>${link}</div>
    <div class="pit-icon enter-2">${PIT_ICONS.info}</div></div>`;
}

// Direction signs: a chalk sign with a route-number circle, the text, a big percentage and an arrow.
// The face is drawn twice: the second copy is highway green with chalk text and is clipped to the
// vote share (--p), so the green fill grows from left to right and the text stays readable on both.
const ARROW = `<svg viewBox="0 0 48 32" aria-hidden="true"><path d="M3 16 H40 M27 4 L42 16 L27 28" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const GRIP = `<svg viewBox="0 0 16 28" aria-hidden="true">${[4, 12].map((x) => [5, 14, 23].map((y) => `<circle cx="${x}" cy="${y}" r="2.6" fill="currentColor"/>`).join("")).join("")}</svg>`;
const gridCls = (n) => (n === 4 ? "grid4" : n === 2 ? "grid2" : "grid1");

/** variant: "" (direction sign) | "ms" (milestone) | "chip" (signboard chip) | "stack" (stacked sign with a drag handle) */
function signHTML(id, k, text, path, L, keyLabel, variant = "") {
  const arrow = variant === "" || variant === "stack";
  const face = (fill) => `<div class="ds-face${fill ? " ds-fill" : ""}"${fill ? ' aria-hidden="true"' : ""}>${variant === "stack" ? `<span class="grip">${GRIP}</span>` : ""}<span class="key">${esc(keyLabel ?? LETTERS[k])}</span><div class="ds-text"><div class="en">${esc(text)}</div>${rl(path, L, "opt")}</div><span class="ds-pct"></span>${arrow ? `<span class="ds-arrow">${ARROW}</span>` : ""}</div>`;
  return `<div class="dsign ${variant} ghost" data-o="${esc(id)}"><div class="flagbar"></div><div class="ds-body">${face(false)}${face(true)}</div></div>`;
}

// A toll barrier for the checkpoint gaps: the boom lifts on the reveal.
const TOLL = (n) => `<svg class="toll" viewBox="0 0 110 132" aria-hidden="true">
  <rect x="10" y="40" width="14" height="86" fill="#1A1A1A"/><rect x="0" y="122" width="34" height="10" fill="#1A1A1A"/>
  <g class="boom"><rect x="17" y="44" width="90" height="14" rx="3" fill="#F5F1E6" stroke="#1A1A1A" stroke-width="3"/>${[30, 54, 78].map((x) => `<rect x="${x}" y="45.5" width="12" height="11" fill="#B5462B"/>`).join("")}</g>
  <circle cx="17" cy="24" r="18" fill="#F2C230" stroke="#1A1A1A" stroke-width="4"/>
  <text x="17" y="33" text-anchor="middle" font-family="Signage" font-weight="800" font-size="27" fill="#1A1A1A">${n}</text></svg>`;

// Word clouds: faint ghost outlines stand in for answers until they arrive; a road is paved underneath.
const GHOSTS = 12;
const GW = [170, 120, 220, 140, 190, 110, 240, 150, 130, 200, 160, 120];
const GH = [52, 40, 64, 44, 56, 38, 70, 46, 42, 60, 50, 40];
function cloudHTML(id, title, cls) {
  return `<div class="cloudwrap ${cls} paving-on">${title ? `<h4 class="cloud-title">${esc(title)}</h4>` : ""}<div class="cloud empty" id="${id}"></div><div class="paving" aria-hidden="true"><i></i></div></div>`;
}

function answersHTML(it, p, L) {
  switch (it.type) {
    case "choose":
      return `<div class="dsigns ${gridCls(it.options.length)}">${it.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.options.${o.id}`, L)).join("")}</div>`;
    case "tapstep":
      return `<div class="milestones" style="--n:${it.steps.length}">${it.steps.map((o, k) => signHTML(o.id, k, o.text, `${p}.steps.${o.id}`, L, k + 1, "ms")).join("")}</div>`;
    case "pickn":
      return `<div class="dsigns chips">${it.items.map((o, k) => signHTML(o.id, k, o.text, `${p}.items.${o.id}`, L, k + 1, "chip")).join("")}</div>`;
    case "rank":
      return `<div class="dsigns stack" id="rankList">${it.items.map((o, k) => signHTML(o.id, k, o.text, `${p}.items.${o.id}`, L, k + 1, "stack")).join("")}</div>`;
    case "checkpoint": {
      const gaps = gapsFor(it);
      let h = `<div class="pipe">`;
      it.steps.forEach((s, k) => {
        h += `<div class="pstep"><div class="n">STEP ${k + 1}</div><div class="en">${esc(s.text)}</div>${rl(`${p}.steps.${s.id}`, L, "opt")}</div>`;
        if (gaps[k]) h += `<div class="pgap ghost" data-o="${gaps[k].id}"><div class="flagbar"></div>${TOLL(k + 1)}<div class="booth"><div class="booth-fill"></div></div><span class="ds-pct"></span></div>`;
      });
      return h + `</div>`;
    }
    case "match":
      return `<div class="lanes" style="--nb:${it.buckets.length}"><div></div>${it.buckets.map((b) => `<div class="lane-sign"><span>${esc(b.text)}</span>${rl(`${p}.buckets.${b.id}`, L, "opt")}<i aria-hidden="true">↓</i></div>`).join("")}${it.items
        .map((x, k) => `<div class="lane-item"><span class="key">${k + 1}</span><div class="en">${esc(x.text)}</div></div>${it.buckets.map((b, bi) => `<div class="lane-cell ghost l${bi}${bi === it.buckets.length - 1 ? " last" : ""}" data-cell="${x.id}:${b.id}"><div class="flagbar"></div><div class="lc-face"><span class="ds-pct"></span></div><div class="lc-face ds-fill" aria-hidden="true"><span class="ds-pct"></span></div></div>`).join("")}`)
        .join("")}</div>`;
    case "estimate":
      return `<div class="est"><div></div>${it.sliders.map((s) => `<div class="hd">${esc(s.text)}${rl(`${p}.sliders.${s.id}`, L, "opt")}</div>`).join("")}
        ${it.periods.map((per) => `<div class="row">${esc(per.text)}</div>${it.sliders.map((s) => `<div class="cell" data-cell="${per.id}_${s.id}"><div class="room"></div><div class="real"></div></div>`).join("")}`).join("")}</div>
        ${it.placeholder ? `<div class="est-note">${esc(it.placeholder)}</div>` : ""}`;
    case "wordcloud":
      return cloudHTML("cloud", "", "single");
    case "dualcloud":
      return `<div class="clouds">${it.parts.map((pt) => cloudHTML(`cloud-${pt.id}`, pt.title, pt.color)).join("")}</div>`;
  }
  return "";
}

/** The split-flap "answers in" counter shown while the room answers. */
const waitHTML = () => `<div class="waitbar"><div class="flapcount hidden" id="ansCount"><span class="flaps"></span><b>answers in</b><em id="ansPending"></em></div><div class="hint" id="hostHint"></div></div>`;

function revealHTML(it, p, L) {
  if (S.phase !== "reveal") return "";
  if (it.type === "dualcloud") return `<div class="signboard final-sign"><div class="q-en">${esc(it.reveal)}</div>${rl(`${p}.reveal`, L)}</div>`;
  const f = S.final[slotOf()] || {};
  let v;
  if (!it.scored) v = `<span class="verdict">${it.type === "wordcloud" && S.i === last ? "Your road ahead" : "No score here"}</span>`;
  else if (f.correct == null) v = `<span class="verdict">No result recorded. The road goes on.</span>`;
  else if (f.correct) v = `<span class="verdict">✓ ${esc(cap(f.text))}. Smooth road!</span>`;
  else v = `<span class="verdict bad">✗ ${esc(cap(f.text))}. Bumpy road: fuel −${cfg("fuelPenalty", 15)}%</span>`;
  return `<div class="explain enter">${v}${esc(it.reveal)}${rl(`${p}.reveal`, L)}</div>`;
}

const PIT_KIND = { petrol: "Petrol pump", landslide: "Landslide ahead", viewpoint: "Viewpoint", mechanic: "Mechanic", checkpost: "Checkpost", chai: "Chai stall" };
function boardHTML(it, compact) {
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  const rule =
    it.pitType === "petrol" ? `Fuel: up to +${it.fuel.shareYes}%, by how many say yes` :
    it.pitType === "landslide" ? `Fuel: ${it.fuel.right}% if the room finds the way round, ${it.fuel.wrong}% if not` :
    it.pitType === "mechanic" ? `Fuel: +${it.fuel.add}%` :
    it.pitType === "checkpost" ? `${it.rounds.length} rounds, ${it.seconds} seconds each · +${it.fuel.perRight}% fuel per right answer` : "";
  return `<div class="board ${it.pitType} grain ${compact ? "compact" : ""} enter">
    <div class="board-kind">${esc(it.title || PIT_KIND[it.pitType] || it.place)}</div>
    <div class="board-text">${esc(it.board)}</div>${rl(`${p}.board`, L)}
    ${!compact && rule ? `<div class="board-rule">${esc(rule)}</div>` : ""}</div>`;
}

function pitHTML(it) {
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  if (S.phase === "arrive") return `<div class="pit">${boardHTML(it, false)}<div class="pit-icon enter-2">${PIT_ICONS[it.pitType] || ""}</div></div>`;
  if (S.phase === "info") {
    if (it.pitType === "mechanic")
      return `<div class="pit ask-mode">${boardHTML(it, true)}<ol class="tips enter-2">${it.tips.map((t, k) => `<li><span>${esc(t)}</span>${rl(`${p}.tips.${k}`, L)}</li>`).join("")}</ol></div>`;
    return `<div class="pit" style="padding-right:300px">${boardHTML(it, false)}<div class="slip grain enter-2" style="font-size:40px">${esc(it.prompt)}${rl(`${p}.prompt`, L)}</div></div>`;
  }
  const reveal = S.phase === "reveal";
  if (it.pitType === "viewpoint") return viewpointHTML(it, S.sub, reveal ? (it.revealAfter ? "held" : "reveal") : "ask");
  if (it.pitType === "checkpost") {
    const rd = it.rounds[S.sub];
    return `<div class="pit ask-mode" style="padding-right:290px">${boardHTML(it, true)}
      <div class="round-no" style="margin-top:14px">Round ${S.sub + 1} of ${it.rounds.length} · ${esc(it.question)}</div>
      <div class="round-item enter-2">${esc(rd.text)}${rl(`${p}.rounds.${rd.id}`, L)}</div>
      <div class="answers"><div class="dsigns ${gridCls(it.options.length)}">${it.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.options.${o.id}`, L)).join("")}</div>${reveal ? "" : waitHTML()}</div>
      ${reveal ? pitVerdict(it) : ""}</div>`;
  }
  return `<div class="pit ask-mode">${boardHTML(it, true)}
    <div class="pit-q"><div class="signboard enter-2"><div class="q-en">${esc(it.poll.question)}</div>${rl(`${p}.poll.question`, L)}</div>
    <div class="answers"><div class="dsigns ${gridCls(it.poll.options.length)}">${it.poll.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.poll.options.${o.id}`, L)).join("")}</div>${reveal ? "" : waitHTML()}</div>
    ${reveal ? pitVerdict(it) : ""}</div></div>`;
}

/** mode: "ask" | "held" (voting closed, answers wait for revealAfter) | "reveal". */
function viewpointHTML(it, sub, mode, banner = "") {
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  const sc = it.showcases[sub];
  const img = sc.image ? `<img class="show-img" src="${esc(sc.image)}" alt="Screenshot of ${esc(sc.title)}"/>` : `<div class="show-blank">Your Tech4Good<br/>example goes here</div>`;
  const note = mode === "held" ? `<div class="held-note">Answers revealed after ${esc(qLabel(it.revealAfter))}</div>` : banner ? `<div class="held-note">${esc(banner)}</div>` : "";
  return `<div class="pit ask-mode">${boardHTML(it, true)}${note}
    <div class="show answers" style="margin-top:16px">
      <div class="show-card grain">${img}<div class="show-title">${esc(sc.title)} <small>(${sub + 1}/${it.showcases.length})</small></div>
        ${sc.url ? `<a class="show-link" href="${esc(sc.url)}" target="_blank" rel="noopener">Open the live site ↗</a>` : ""}
        ${sc.note && mode === "reveal" ? `<div class="show-note">${esc(sc.note)}</div>` : ""}</div>
      <div class="polls">${it.polls
        .map((q) => `<div class="poll" data-poll="${q.id}"><h4>${esc(q.question)}${rl(`${p}.polls.${q.id}.question`, L, "opt")}</h4><div class="dsigns grid1">${q.options.map((o, k) => signHTML(`${q.id}:${o.id}`, k, o.text, "", [], LETTERS[k])).join("")}</div></div>`)
        .join("")}</div></div></div>`;
}

function pitVerdict(it) {
  const f = S.final[slotOf()] || {};
  const d = f.delta || 0;
  const fuelTxt = d ? `Fuel ${d > 0 ? "+" : "−"}${Math.abs(d)}%` : "No fuel change";
  let v = fuelTxt;
  if (it.pitType === "landslide" || it.pitType === "checkpost") v = f.correct ? `✓ ${cap(f.text)}. ${fuelTxt}` : f.correct === false ? `✗ ${cap(f.text)}. ${fuelTxt}` : `No result recorded. ${fuelTxt}`;
  if (it.pitType === "petrol") v = f.text ? `${cap(f.text)}. ${fuelTxt}` : `No result recorded. ${fuelTxt}`;
  return `<div class="explain enter"><span class="verdict ${f.correct === false ? "bad" : ""}">${esc(v)}</span></div>`;
}

function summaryHTML() {
  const scored = R.filter(isScoredQ);
  const won = R.filter((it, i) => isScoredQ(it) && S.final[slotOf(i, 0)]?.correct === true).length;
  const pits = R.map((it, i) => ({ it, i })).filter((x) => x.it.kind === "pitstop");
  return `<div class="summary">
    <div><h1 class="enter">We made it to ${esc(short(R[last].place))}!</h1>
      <div class="stats enter-2">
        <div class="stat"><b>${won}/${scored.length}</b><span>Questions won</span></div>
        <div class="stat"><b>${fuel()}%</b><span>Fuel left</span></div>
        <div class="stat"><b>${R[last].km.toLocaleString("en-IN")}</b><span>Kilometres</span></div>
        <div class="stat"><b>${S.languages || "–"}</b><span>Languages played</span></div>
      </div>
      <div class="closing enter-3">${esc(en.closingLine)}</div></div>
    <div class="passport grain enter-2"><h3>Travel log</h3><div class="passport-grid">${pits
      .map((x) => `<div><div class="slot">${S.stamps[x.i] ? stampHTML(x.it, x.i, true) : ""}</div><div class="slot-label">${esc(x.it.place)}</div></div>`)
      .join("")}</div></div></div>`;
}

// ------------------------------------------------------------------ live chart updates (no re-animation)
function setFlags(el, flags) {
  const bar = el.querySelector(".flagbar");
  if (bar) bar.innerHTML = flags.map(([cls, txt]) => `<span class="flag ${cls}">${esc(txt)}</span>`).join("");
}
/** Grow the green fill to p% and write the big percentage; null text = no answers yet (ghost). */
function setFill(el, p, txt) {
  if (!el) return;
  el.style.setProperty("--p", `${Math.max(0, Math.min(100, p))}%`);
  el.classList.toggle("ghost", txt == null);
  el.querySelectorAll(".ds-pct").forEach((x) => (x.textContent = txt ?? ""));
}
/** Reveal state: "right" stays bright, "almost" gets a small tag, "out" fades to 40%. */
function setState(el, st) {
  for (const c of ["right", "almost", "out"]) el.classList.toggle(c, st === c);
}

// Split-flap counter that ticks up to its target.
function drawFlaps(box, n) {
  const s = String(n).padStart(3, "0");
  if (box.children.length !== s.length) box.innerHTML = [...s].map(() => `<span class="flap"></span>`).join("");
  [...s].forEach((ch, k) => {
    const el = box.children[k];
    if (el.textContent === ch) return;
    el.textContent = ch;
    if (reduceMotion()) return;
    el.classList.remove("flip");
    void el.offsetWidth;
    el.classList.add("flip");
  });
}
function setCount(el, n) {
  if (!el) return;
  el.dataset.target = Math.max(0, n | 0);
  if (el.dataset.shown == null) {
    el.dataset.shown = "0";
    drawFlaps(el.querySelector(".flaps"), 0);
  }
  if (el.dataset.ticking) return;
  const step = () => {
    const cur = Number(el.dataset.shown);
    const tgt = Number(el.dataset.target);
    if (cur === tgt || !el.isConnected) return delete el.dataset.ticking;
    const next = reduceMotion() ? tgt : cur + Math.sign(tgt - cur) * Math.max(1, Math.ceil(Math.abs(tgt - cur) / 12));
    el.dataset.shown = next;
    drawFlaps(el.querySelector(".flaps"), next);
    el.dataset.ticking = "1";
    setTimeout(step, 70);
  };
  step();
}

const isCloud = (it) => it.type === "wordcloud" || it.type === "dualcloud";
const partOf = (w) => w.part || "";
const wordsFor = (part = "") => (live.on ? S.liveWords : S.words).filter((w) => partOf(w) === part);
function renderCloud(box, words, rev, lo, hi) {
  if (!box) return;
  const max = Math.max(1, ...words.map((w) => w.n));
  const list = rev ? [...words].sort((a, b) => b.n - a.n) : words;
  const ghosts = rev ? 0 : Math.max(0, GHOSTS - words.length);
  const key = JSON.stringify([list.map((w) => [w.text, w.n]), ghosts, rev]);
  box.classList.toggle("empty", !words.length);
  box.classList.toggle("settled", rev);
  box.closest(".cloudwrap")?.classList.toggle("paving-on", !rev && words.length < 6);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML =
    list.map((w, k) => `<span class="w" style="font-size:${lo + Math.round((w.n / max) * (hi - lo))}px;--d:${((k * 0.37) % 2).toFixed(2)}s">${esc(w.text)}</span>`).join("") +
    Array.from({ length: ghosts }, (_, k) => `<span class="ghost-w" style="width:${GW[k % GW.length]}px;height:${GH[k % GH.length]}px"></span>`).join("");
}

function updateResults() {
  if (!["ask", "reveal"].includes(S.phase)) return;
  const step = stepOf();
  let it = item();
  let sub = S.sub;
  if (step.t === "held") [it, sub] = [R[step.vi], step.k];
  const slot = slotOf();
  const t = tallyOf(slot);
  const r = resultFor(S.i, S.sub);
  const rev = S.phase === "reveal" && !heldHere(it);
  const m = S.manual[slot] || {};
  const almost = it.almost || [];
  const stateOf = (id, answer) => (!rev || answer == null ? "" : id === answer ? "right" : almost.includes(id) ? "almost" : "out");
  const tagsFor = (st, right = "✓ Right route") => (st === "right" ? [["best", right]] : st === "almost" ? [["almost", "Almost"]] : []);
  const room = (id, label = "Room's pick") => (r.choice === id ? [["room", rev || m.choice ? label : "Leading"]] : []);
  const share = (id) => {
    const p = pct(t.counts[id] || 0, t.n);
    return [p, t.n ? `${p}%` : null];
  };

  if (step.t === "mirror") {
    document.querySelectorAll(".answers .dsign").forEach((el) => {
      const id = el.dataset.o;
      setFill(el, ...share(id));
      el.classList.toggle("lead", r.choice === id);
      setFlags(el, room(id));
    });
  } else if (it.kind === "question") {
    switch (it.type) {
      case "choose":
      case "tapstep":
        document.querySelectorAll(".answers .dsign").forEach((el) => {
          const id = el.dataset.o;
          setFill(el, ...share(id));
          const st = stateOf(id, it.answer);
          setState(el, st);
          el.classList.toggle("lead", r.choice === id);
          setFlags(el, [...tagsFor(st, it.type === "tapstep" ? "✓ Went wrong here" : "✓ Right route"), ...room(id)]);
        });
        break;
      case "checkpoint":
        document.querySelectorAll(".pgap").forEach((el) => {
          const id = el.dataset.o;
          setFill(el, ...share(id));
          const st = stateOf(id, it.answer);
          setState(el, st);
          el.classList.toggle("lead", r.choice === id);
          setFlags(el, [...tagsFor(st, "✓ Human check"), ...room(id, "Room")]);
        });
        break;
      case "pickn":
        document.querySelectorAll(".answers .dsign").forEach((el) => {
          const id = el.dataset.o;
          setFill(el, ...share(id));
          const decoy = it.decoys.includes(id);
          const st = !rev ? "" : decoy ? "out" : "right";
          setState(el, st);
          const picked = r.picks?.includes(id);
          el.classList.toggle("lead", !!picked);
          setFlags(el, [...(rev ? [decoy ? ["decoy", "✗ Decoy"] : ["best", "✓"]] : []), ...(picked ? [["room", `Room's top ${it.n}`]] : [])]);
        });
        break;
      case "rank": {
        const list = $("#rankList");
        document.querySelectorAll(".answers .dsign").forEach((el) => {
          const id = el.dataset.o;
          const a = avgPos(t, id);
          setFill(el, t.n ? ((it.items.length - a + 1) / it.items.length) * 100 : 0, t.n ? `avg ${a.toFixed(1)}` : null);
          const flags = [];
          if (rev && id === it.firstItem) flags.push(["best", `✓ ${en.ui.lowestRisk}`]);
          if (rev && id === it.lastItem) flags.push(["best", `✓ ${en.ui.highestRisk}`]);
          if (r.order) flags.push(["room", `Room #${r.order.indexOf(id) + 1}`]);
          setState(el, rev && (id === it.firstItem || id === it.lastItem) ? "right" : "");
          setFlags(el, flags);
        });
        if (rev && r.order && list) r.order.forEach((id) => list.appendChild(list.querySelector(`[data-o="${id}"]`)));
        break;
      }
      case "match":
        it.items.forEach((x) => {
          const rowTotal = it.buckets.reduce((s, b) => s + (t.counts[`${x.id}:${b.id}`] || 0), 0);
          it.buckets.forEach((b) => {
            const cell = document.querySelector(`[data-cell="${x.id}:${b.id}"]`);
            const p = pct(t.counts[`${x.id}:${b.id}`] || 0, rowTotal);
            setFill(cell, p, rowTotal ? `${p}%` : null);
            const lead = r.map?.[x.id] === b.id;
            cell.classList.toggle("lead", lead);
            const st = !rev ? "" : it.answers[x.id] === b.id ? "right" : "out";
            setState(cell, st);
            setFlags(cell, [...(st === "right" ? [["best", "✓"]] : []), ...(lead ? [["room", "Room"]] : [])]);
          });
        });
        break;
      case "estimate":
        it.periods.forEach((per) =>
          it.sliders.forEach((s) => {
            const cell = document.querySelector(`[data-cell="${per.id}_${s.id}"]`);
            const med = t.nums?.[`${per.id}_${s.id}`]?.median;
            const show = (v) => (s.format === "inr" ? inr(v) : `${v < 1 ? "<1" : Math.round(v)} weeks`);
            cell.querySelector(".room").innerHTML = med != null ? `Room: <b>${show(med)}</b>` : live.on ? "Room: –" : "";
            cell.querySelector(".real").innerHTML = rev ? `Real: <b>${s.format === "inr" ? (per.id === "now" ? "under " : "") + inr(it.answer[per.id][s.id]) : esc(it.answerText[per.id].split(",")[0])}</b>` : "";
          })
        );
        break;
      case "wordcloud":
        renderCloud($("#cloud"), wordsFor(""), rev, 34, 84);
        break;
      case "dualcloud":
        it.parts.forEach((pt) => renderCloud($(`#cloud-${pt.id}`), wordsFor(pt.id), rev, 26, 56));
        break;
    }
  } else if (it.pitType === "viewpoint") {
    const sc = it.showcases[sub];
    it.polls.forEach((q) => {
      const tot = q.options.reduce((s, o) => s + (t.counts[`${q.id}:${o.id}`] || 0), 0);
      const lead = majority(Object.fromEntries(q.options.map((o) => [o.id, t.counts[`${q.id}:${o.id}`] || 0])), q.options.map((o) => o.id));
      q.options.forEach((o) => {
        const el = document.querySelector(`.dsign[data-o="${q.id}:${o.id}"]`);
        const c = t.counts[`${q.id}:${o.id}`] || 0;
        setFill(el, pct(c, tot), tot ? `${pct(c, tot)}%` : null);
        const st = !rev ? "" : sc.answers[q.id] === o.id ? "right" : "out";
        setState(el, st);
        setFlags(el, [...tagsFor(st, "✓ Real answer"), ...(lead === o.id ? [["room", "Room"]] : [])]);
      });
    });
  } else if (["petrol", "landslide", "checkpost"].includes(it.pitType)) {
    const answer = it.pitType === "checkpost" ? it.rounds[S.sub].answer : it.answer;
    document.querySelectorAll(".answers .dsign").forEach((el) => {
      const id = el.dataset.o;
      let [p, txt] = share(id);
      const est = it.pitType === "petrol" && m.pct != null;
      if (est) {
        p = id === "yes" ? m.pct : 100 - m.pct;
        txt = `${p}%`;
      }
      setFill(el, p, txt);
      const st = it.pitType === "petrol" ? "" : stateOf(id, answer);
      setState(el, st);
      el.classList.toggle("lead", r.choice === id);
      setFlags(el, [...tagsFor(st), ...(est ? [["room", "Room estimate"]] : []), ...room(id)]);
    });
  }
  const hint = $("#hostHint");
  if (hint) hint.textContent = live.on ? "" : hostHint(it);
  // "answers in": phones that answered (Live), or entries typed in (Host Mode word clouds)
  const counter = $("#ansCount");
  if (counter) {
    const cloud = isCloud(it);
    const n = live.on ? t.n : cloud ? S.words.filter((w) => (it.type === "dualcloud" ? !!w.part : !w.part)).reduce((s, w) => s + w.n, 0) : 0;
    counter.classList.toggle("hidden", !(live.on || cloud));
    $("#ansPending").textContent = live.on && cloud && S.pending ? `· ${S.pending} waiting for the moderator` : "";
    setCount(counter, n);
  }
  const qc = $("#qrCount");
  if (qc) qc.textContent = `${t.n} answer${t.n === 1 ? "" : "s"}${S.closed[slot] ? " · closed" : ""}`;
}

function hostHint(it) {
  if (it.kind === "question" && stepOf().t === "mirror") return "Show of hands: where is your organisation?";
  if (it.kind === "question")
    return { choose: "Show of hands: A, B, C or D?", tapstep: "Show of hands: which step went wrong?", checkpoint: "Show of hands: which gap needs a human?", pickn: `Show of hands for each one. The room picks ${it.n}.`, rank: "Call out the order: lowest risk first.", match: "Show of hands: which bucket for each?", estimate: "Call out your guesses!", wordcloud: "Call out your answers!", dualcloud: "Call out your answers for both!" }[it.type] || "";
  return { petrol: "Show of hands: who will try this?", landslide: "Show of hands: A, B or C?", checkpost: "Show of hands: where does it go?", viewpoint: "Guess out loud!" }[it.pitType] || "";
}

// ------------------------------------------------------------------ Host Mode entry (also overrides live)
function entryHelp(it) {
  if (it.kind === "card") return "→ to ride on";
  if (it.kind === "question" && stepOf().t === "held") return "Viewpoint answers · → next";
  if (it.kind === "question" && stepOf().t === "mirror") return `Keys A–${LETTERS[it.mirror.options.length - 1]}: room's pick (no right answer)`;
  if (it.kind === "question" && S.phase === "hurdle") return `→ next hurdle (${S.hurdle}/${it.hurdles.length}), then voting opens`;
  if (it.kind === "question")
    return { choose: "Keys A–D: room's majority", tapstep: `Keys 1–${it.steps?.length}: step the room picked`, checkpoint: "Keys 1–4: gap the room picked", pickn: `Keys 1–8: toggle the room's top ${it.n} · 0 clears`, rank: "Type the room's order 1–4, lowest risk first · 0 clears", match: "Keys 1–4: cycle that item's bucket · 0 clears", estimate: "Nothing to enter · R reveals", wordcloud: "W adds a word to the cloud", dualcloud: `W adds to ${(it.parts?.[0]?.title || "").toUpperCase()} · N adds to ${(it.parts?.[1]?.title || "").toUpperCase()}` }[it.type];
  return { petrol: "↑ / ↓: % of the room saying Yes", landslide: "Keys A–C: room's majority", checkpost: "Keys A–C: room's majority", viewpoint: "Nothing to enter · R reveals, → next showcase", mechanic: "→ to ride on", chai: "→ to ride on" }[it.pitType];
}

function enter(index) {
  if (busy) return;
  const it = item();
  if (S.phase === "arrive" && hasQuestion(it) && !it.hurdles?.length) {
    S.phase = "ask";
    if (it.pitType === "checkpost") autoTimer(it.seconds, "Round 1");
  }
  if (S.phase === "hurdle") return toast("Press → to show the remaining hurdles first.");
  if (S.phase === "reveal") return toast("Press ← to undo the reveal before changing the room's result.");
  if (S.phase !== "ask") return;
  const slot = slotOf();
  if (index === -1) {
    delete S.manual[slot];
    return commit();
  }
  const m = (S.manual[slot] = { ...(S.manual[slot] || {}) });
  const mirror = it.kind === "question" && stepOf().t === "mirror";
  const kind = mirror ? "mirror" : it.kind === "question" ? it.type : it.pitType;
  const choices = mirror ? it.mirror.options : it.kind === "question" ? choicesFor(it) : it.pitType === "checkpost" ? it.options : it.poll?.options || [];
  switch (kind) {
    case "choose":
    case "tapstep":
    case "checkpoint":
    case "landslide":
    case "checkpost":
    case "mirror":
      if (index < choices.length) {
        if (m.choice === choices[index].id) delete m.choice;
        else m.choice = choices[index].id;
      }
      break;
    case "pickn": {
      if (index >= it.items.length) break;
      const id = it.items[index].id;
      m.picks = m.picks || [];
      if (m.picks.includes(id)) m.picks = m.picks.filter((x) => x !== id);
      else if (m.picks.length < it.n) m.picks.push(id);
      else toast(`The room's top ${it.n} is full. Press a picked number again to remove it, or 0 to clear.`);
      break;
    }
    case "rank": {
      if (index >= it.items.length) break;
      const id = it.items[index].id;
      m.order = (m.order || []).filter((x) => x !== id);
      if (m.order.length >= it.items.length) m.order = [];
      m.order.push(id);
      break;
    }
    case "match": {
      if (index >= it.items.length) break;
      const id = it.items[index].id;
      const bids = it.buckets.map((b) => b.id);
      m.match = { ...(m.match || {}) };
      const k = bids.indexOf(m.match[id]);
      if (k === bids.length - 1) delete m.match[id];
      else m.match[id] = bids[k + 1];
      break;
    }
  }
  commit();
}

function adjustPct(d) {
  const it = item();
  if (busy || S.phase !== "ask" || it.pitType !== "petrol") return;
  const m = (S.manual[slotOf()] = { ...(S.manual[slotOf()] || {}) });
  m.pct = m.pct == null ? 50 : Math.max(0, Math.min(100, m.pct + d));
  commit();
}

// ------------------------------------------------------------------ flow
/** Ride between stops (never between steps of one stop). */
async function rideTo(target) {
  busy = true;
  const from = S.i;
  const t = R[target];
  const k0 = R[from].km;
  const k1 = t.km;
  $("#stage").classList.remove("band-short");
  $("#stage").classList.add("band-tall");
  $("#scene").innerHTML = `<div class="riding"><div class="next-sign"><small>${target > from ? `Next stop · ${t.stopIndex + 1} of ${stopCount()}` : `Back to stop ${t.stopIndex + 1}`}</small><b>${esc(t.milestone || short(t.stopPlace))}</b><span>${Math.abs(k1 - k0)} km ${target > from ? "→" : "←"}</span></div></div>`;
  sceneKey = "";
  $("#qrCard").classList.add("hidden");
  $("#timerBox").classList.add("hidden");
  if (live.on) syncServer({ slot: t.id, phase: "arrive" });
  let lastFlap = 0;
  await band.ride(R[from].stopIndex, t.stopIndex, RIDE_MS, (e) => {
    const now = performance.now();
    if (now - lastFlap > 110) {
      lastFlap = now;
      setKm(k0 + (k1 - k0) * e);
    }
  });
  setKm(k1);
  busy = false;
}

function autoTimer(seconds, label) {
  S.timer = { endsAt: Date.now() + seconds * 1000, duration: seconds, label, startedAt: Date.now() };
  // Sent after the server has moved to this step (see syncServer): moving to a new step resets the
  // server's timer, so a timer that arrived first would be wiped and the round would close at once.
  if (live.on) live.pendingTimer = seconds;
}

/** Open the current step's first screen. No ride, no arrival. Returns the fuel before (for the flash). */
function startStep() {
  const it = item();
  const before = fuel();
  S.sub = 0;
  S.hurdle = 0;
  if (it.kind === "intro" || it.kind === "card") S.phase = "card";
  else if (it.hurdles?.length) {
    S.phase = "hurdle";
    S.hurdle = 1;
  } else if (hasQuestion(it)) {
    S.phase = "ask";
    if (it.pitType === "checkpost") autoTimer(it.seconds, "Round 1");
  } else {
    S.phase = "info";
    if (it.pitType === "mechanic") S.final[slotOf()] = { delta: it.fuel.add };
    if (it.pitType === "chai") autoTimer(it.seconds, "Chai break");
    stamp(S.i);
  }
  return before;
}
/** The last screen of a step (used when stepping back into it). */
function endStep() {
  const it = item();
  S.sub = subCount(it) - 1;
  S.hurdle = it.hurdles?.length || 0;
  S.phase = it.kind === "intro" || it.kind === "card" ? "card" : hasQuestion(it) ? "reveal" : "info";
}

async function next() {
  if (busy) return;
  const it = item();
  switch (S.phase) {
    case "lobby":
      S.i = 0;
      S.phase = "arrive";
      stats.arrivals.push({ stop: R[0].stopId, km: R[0].km });
      break;
    case "arrive": {
      const before = startStep();
      commit();
      return flashFuel(before, fuel());
    }
    case "hurdle":
      if (S.hurdle < it.hurdles.length) S.hurdle++;
      else {
        S.phase = "ask";
        S.sub = 0;
      }
      break;
    case "ask":
      return reveal();
    case "reveal":
      if (hasSubs(it) && S.sub < subCount(it) - 1) {
        S.sub++;
        S.phase = stepOf().t === "held" ? "reveal" : "ask"; // held viewpoint answers were collected earlier
        if (it.pitType === "checkpost") autoTimer(it.seconds, `Round ${S.sub + 1}`);
        break;
      }
      return advance();
    case "info":
    case "card":
      return advance();
    default:
      return;
  }
  commit();
}
/** Forward to the next step: the same stop changes only the main panel; a new stop rides and arrives. */
async function advance() {
  const it = item();
  S.timer = { endsAt: null, duration: S.timer.duration, label: "" };
  if (S.i >= last) S.phase = "summary";
  else if (R[S.i + 1].stopIndex === it.stopIndex) {
    S.i++;
    const before = startStep();
    commit();
    return flashFuel(before, fuel());
  } else {
    await rideTo(S.i + 1);
    S.i++;
    S.sub = 0;
    S.hurdle = 0;
    S.phase = "arrive";
    stats.arrivals.push({ stop: item().stopId, km: item().km });
  }
  commit();
}

function reveal() {
  if (busy) return;
  const it = item();
  if (S.phase === "arrive" || S.phase === "hurdle") return next();
  if (S.phase !== "ask") return;
  const r = resultFor(S.i, S.sub);
  const needs = ((isScoredQ(it) && stepOf().t === "main") || ["petrol", "landslide", "checkpost"].includes(it.pitType)) && !r.has;
  if (needs && Date.now() - armed > 4000) {
    armed = Date.now();
    toast(`${entryHelp(it)}. Or press R again to reveal anyway.`);
    return;
  }
  armed = 0;
  const slot = slotOf();
  if (live.on) S.closed[slot] = true;
  const before = fuel();
  S.final[slot] = { correct: r.correct, delta: r.delta || 0, text: r.text };
  S.phase = "reveal";
  if (it.kind === "pitstop" && (!hasSubs(it) || S.sub === subCount(it) - 1)) stamp(S.i);
  if (S.timer.endsAt) S.timer = { ...S.timer, endsAt: null };
  commit();
  flashFuel(before, fuel());
}

async function back() {
  if (busy) return;
  const it = item();
  const slot = slotOf();
  // Back from a step's first screen: the previous step's last screen (same stop), or the stop's arrival.
  const stepBack = () => {
    if (it.stepIndex === 0 || it.stepIndex == null) S.phase = "arrive";
    else {
      S.i--;
      endStep();
    }
  };
  switch (S.phase) {
    case "summary":
      S.phase = "reveal";
      break;
    case "reveal":
      if (stepOf().t === "held") {
        S.sub--; // the viewpoint's own result stays; step back to the previous screen
        S.phase = "reveal";
        break;
      }
      delete S.final[slot];
      if (it.kind === "pitstop") delete S.stamps[S.i];
      S.phase = "ask";
      break;
    case "hurdle":
      if (S.hurdle > 1) S.hurdle--;
      else stepBack();
      break;
    case "info":
      delete S.final[slot];
      delete S.stamps[S.i];
      stepBack();
      break;
    case "card":
      stepBack();
      break;
    case "ask":
      if (hasSubs(it) && S.sub > 0) {
        S.sub--;
        S.phase = "reveal";
      } else if (it.hurdles?.length) {
        S.phase = "hurdle";
        S.hurdle = it.hurdles.length;
      } else stepBack();
      break;
    case "arrive":
      if (S.i === 0) S.phase = "lobby";
      else {
        await rideTo(S.i - 1);
        S.i--;
        endStep();
      }
      break;
    default:
      return;
  }
  renderLog(null);
  commit();
}

function toggleVote() {
  if (!live.on || S.phase !== "ask") return;
  S.closed[slotOf()] = !S.closed[slotOf()];
  commit();
}

/** Host Mode (or a presenter extra in Live): add an answer to the word cloud. Dual clouds: W = first part, N = second. */
async function addWord(which = 0) {
  const it = item();
  if (!isCloud(it) || !["ask", "reveal"].includes(S.phase) || stepOf().t !== "main") return;
  const part = it.type === "dualcloud" ? it.parts[which] : null;
  if (which && !part) return;
  const text = await modal({ title: part ? `Add to ${part.title.toUpperCase()}` : "Add to the word cloud", text: part ? `${part.text} (up to 40 characters)` : "Type an answer from the room (up to 40 characters).", input: true, inputType: "text", ok: "Add" });
  if (!text) return;
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 40);
  if (isProfane(clean)) return toast("That one was filtered. Try different words.");
  if (live.on) {
    try { await adminCall({ action: "addWord", text: clean, ...(part ? { part: part.id } : {}) }); } catch { toast("Couldn't reach the server."); }
    return;
  }
  const hit = S.words.find((w) => partOf(w) === (part?.id || "") && w.text.toLowerCase() === clean.toLowerCase());
  if (hit) hit.n++;
  else S.words.push({ text: clean, n: 1, ...(part ? { part: part.id } : {}) });
  commit();
}

function commit() {
  $("#toast").classList.remove("show");
  save();
  render();
  announce();
  if (live.on) syncServer();
}

// ------------------------------------------------------------------ timer
const timerRunning = () => !!(S?.timer?.endsAt && S.timer.endsAt > Date.now());
let wasRunning = false;
function tick() {
  if (!S) return;
  rotateRegional(performance.now());
  renderTimer();
}
function renderTimer() {
  const it = item();
  const running = timerRunning();
  const show = running && it.kind === "pitstop" && !busy && S.phase !== "summary";
  $("#timerBox").classList.toggle("hidden", !show);
  if (show) {
    const left = Math.max(0, S.timer.endsAt - Date.now());
    const sec = Math.ceil(left / 1000);
    $("#timerNum").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    $("#timerLabel").textContent = S.timer.label || "Timer";
    $("#timerRing").style.strokeDashoffset = String(691 * (1 - left / (S.timer.duration * 1000)));
    $("#timerBox").classList.toggle("ending", sec <= 5);
  }
  if (wasRunning && !running && it.pitType === "checkpost" && S.phase === "ask" && live.on && !S.closed[slotOf()]) {
    // Checkpost rounds close themselves when the seconds run out
    S.closed[slotOf()] = true;
    commit();
  }
  if (wasRunning !== running) updateBar();
  wasRunning = running;
}
function setTimer(cmd, duration, fromRemote) {
  const d = Number(duration) || S.timer.duration || cfg("timerSeconds", 60);
  S.timer = cmd === "start" ? { endsAt: Date.now() + d * 1000, duration: d, label: "Discussion" } : { endsAt: null, duration: d, label: "" };
  save();
  renderTimer();
  updateBar();
  announce();
  if (live.on && !fromRemote) adminCall({ action: "timer", cmd, duration: d }).catch(() => {});
}

// ------------------------------------------------------------------ QR, bar, toast, modal
function makeQR(target, url) {
  try {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {}
}
function updateQR() {
  const card = $("#qrCard");
  if (live.on && !card.dataset.url) {
    makeQR($("#qrSmall"), voteUrl());
    $("#qrUrl").textContent = shortUrl();
    card.dataset.url = "1";
  }
  card.classList.toggle("hidden", !(live.on && S.phase === "ask" && !busy));
  if (S.phase === "ask" && live.on && !openedAt[slotOf()]) openedAt[slotOf()] = Date.now();
}
function updateBar() {
  const it = item();
  $("#barWhere").textContent = ["lobby", "summary"].includes(S.phase) ? cap(S.phase) : `S${it.stopIndex + 1}·${it.stepIndex + 1} ${it.kind === "question" ? `Q${qNumber(S.i)}` : it.title || it.place || it.id}${hasSubs(it) ? ` ${S.sub + 1}/${subCount(it)}` : ""}`;
  $("#barMode").textContent = live.on ? (live.wsOpen ? "LIVE" : "LIVE (polling)") : live.lost ? "HOST · Live lost" : "HOST";
  $("#barMode").classList.toggle("live", live.on);
  $("#barMode").classList.toggle("lost", !live.on && live.lost);
  $("#btnLive").classList.toggle("hidden", !(live.canReturn && !live.on));
  $("#btnNext").textContent = S.phase === "lobby" ? "Start ▶" : "Next ▶";
  const low = lowTurnout();
  $("#barLow").classList.toggle("hidden", !low);
  if (low) $("#barLow").textContent = `Low turnout (${tallyOf(slotOf()).n}). Enter the room's result by hand? ${entryHelp(it) || ""}`;
  $("#barVotes").textContent = `${tallyOf(slotOf()).n} answers${S.pending ? ` · ${S.pending} words waiting` : ""}`;
  $("#barVotes").classList.toggle("hidden", !live.on);
  const res = ["ask", "reveal"].includes(S.phase) ? resultFor(S.i, S.sub).text : "";
  $("#barHint").textContent =
    S.phase === "lobby" ? (live.on ? (isPrivateHost(new URL(voteUrl()).hostname) ? `Phones join at ${shortUrl()}: this address only works on this network. Deploy for a public link.` : `Phones join at ${shortUrl()} · → starts the ride`) : "Host Mode · → starts the ride") :
    S.phase === "ask" ? `${entryHelp(it) || ""}${res ? ` · now: ${res}` : ""}` : S.phase === "reveal" ? res : "";
  $("#btnClose").classList.toggle("hidden", !(live.on && S.phase === "ask"));
  $("#btnClose").textContent = S.closed[slotOf()] ? "Reopen vote" : "Close vote";
  const cloudStep = isCloud(it) && ["ask", "reveal"].includes(S.phase) && stepOf().t === "main";
  $("#btnWord").classList.toggle("hidden", !cloudStep);
  $("#btnWord").textContent = it.type === "dualcloud" ? `Add ${it.parts[0].title}` : "Add word";
  $("#btnNever").classList.toggle("hidden", !(cloudStep && it.type === "dualcloud"));
  if (it.type === "dualcloud") $("#btnNever").textContent = `Add ${it.parts[1].title}`;
  $("#btnTimer").textContent = timerRunning() ? "Stop timer" : "Timer";
}
let toastT;
function toast(msg, ms = 3800) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
}
let modalOpen = false;
function modal({ title, text, input, inputType = "password", ok = "OK", error = "" }) {
  return new Promise((resolve) => {
    modalOpen = true;
    $("#modalBox").innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>${input ? `<input id="modalInput" type="${inputType}" maxlength="60" autocomplete="off" aria-label="${esc(title)}" />` : ""}<div class="err">${esc(error)}</div><div class="row"><button id="modalCancel">Cancel</button><button class="go" id="modalOk">${esc(ok)}</button></div>`;
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
  const pin = await modal({ title: "Reset the ride?", text: live.on ? "This clears ALL answers, words and fuel on the server and returns to Bengaluru. Enter the PIN." : "This clears the room's answers, fuel and stamps and returns to Bengaluru.", input: live.on, ok: "Reset" });
  if (pin === null) return;
  if (live.on) {
    try {
      const r = await adminCall({ action: "reset" }, pin);
      if (r.status === 401) return toast("Wrong PIN. Nothing was reset.");
      if (!r.ok) return toast("Reset failed: " + (r.data?.error || r.status));
      try { localStorage.setItem(PIN_KEY, pin); } catch {}
      S = fresh("live");
      S.round = r.data.state.round;
    } catch {
      return toast("Couldn't reach the server. Nothing was reset.");
    }
  } else S = fresh("host");
  sceneKey = "";
  $("#qrCard").dataset.url = "";
  renderLog(null);
  commit();
  toast("Ride reset. Ready at Bengaluru.");
}

// ------------------------------------------------------------------ moderator sync on this laptop
function announce() {
  if (!channel || !S) return;
  const st = stepOf();
  channel.postMessage({ type: "state", i: st.t === "held" ? st.vi : S.i, sub: st.t === "held" ? st.k : S.sub, mirror: st.t === "mirror", lost: live.lost && !live.on, phase: S.phase, slot: slotOf(), mode: live.on ? "live" : "host", n: tallyOf(slotOf()).n, timer: S.timer, result: ["ask", "reveal"].includes(S.phase) ? resultFor(S.i, S.sub).text : "", words: S.words, at: Date.now() });
}
if (channel)
  channel.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === "timer") setTimer(m.cmd, m.duration, m.viaServer);
    if (m.type === "hello") announce();
  };

// ------------------------------------------------------------------ live mode
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
async function enableLive(silent) {
  if (!location.protocol.startsWith("http")) return toast("Live Vote needs the game served from the Cloudflare Worker.");
  // Is there a Live server at all? (No PIN needed to ask.) If not, stay in Host Mode and keep checking.
  try {
    const r = await fetchT(`${location.origin}/api/state`, {}, 4000);
    if (r.status === 404) live.noApi = true; // a plain static server (npm run host): Host Mode only, nothing to wait for
    if (!r.ok) throw new Error(r.status);
  } catch {
    return fallbackToHost(silent ? null : "Live server unreachable. Using Host Mode; it switches back when the server returns.");
  }
  let pin = null;
  try { pin = localStorage.getItem(PIN_KEY); } catch {}
  let error = "";
  for (let k = 0; k < 5; k++) {
    if (!pin) {
      pin = await modal({ title: "Live Vote", text: "Enter the presenter PIN.", input: true, ok: "Go live", error });
      if (pin === null) return fallbackToHost(null);
    }
    let r;
    try { r = await adminCall({ action: "check" }, pin); } catch { return fallbackToHost("Live voting server unreachable. Using Host Mode (press L to retry)."); }
    if (r.status === 401) {
      pin = null;
      error = "Wrong PIN, try again.";
      try { localStorage.removeItem(PIN_KEY); } catch {}
      continue;
    }
    if (!r.ok) return fallbackToHost(`Live server error (${r.data?.error || r.status}). Using Host Mode.`);
    try { localStorage.setItem(PIN_KEY, pin); } catch {}
    if (S.round && S.round !== r.data.state.round) {
      S.tallies = {};
      S.closed = {};
    }
    S.round = r.data.state.round;
    const wasLost = live.lost;
    live.on = true;
    live.lost = false;
    live.canReturn = false;
    live.fails = 0;
    live.lastOk = Date.now();
    S.mode = "live";
    $("#qrCard").dataset.url = "";
    connectWS();
    startPolling();
    commit(); // pushes the current stop/step to the server: the game carries on where it is
    if (!silent || wasLost) toast(wasLost ? "Back to Live. Phones rejoin on the current step." : `Live Vote on. Audience: ${shortUrl()}`);
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
  S.mode = "host";
  for (const w of S.liveWords || []) if (!S.words.find((x) => x.text === w.text && partOf(x) === partOf(w))) S.words.push(w); // keep approved words
  save();
  render();
  announce();
  if (msg) toast(msg, was ? 6000 : 4000);
}
let lastHealth = 0;
/** Every second: Live silent > 5 s → Host Mode; in Host Mode, every 3 s check whether the server is back. */
function watchdog() {
  const now = Date.now();
  if (live.on && now - live.lastOk > LOST_AFTER_MS) return fallbackToHost("Live server lost for 5 seconds: switched to Host Mode. Answers so far are kept.");
  if (!live.on && !live.noApi && S && S.mode === "host" && location.protocol.startsWith("http") && now - lastHealth > 3000 && new URLSearchParams(location.search).get("mode") !== "host") {
    lastHealth = now;
    fetchT(`${location.origin}/api/state`, {}, 2000)
      .then((r) => {
        const ok = r.ok;
        if (ok && !live.canReturn) {
          live.canReturn = true;
          if (live.lost) toast("The Live server is back. Press L (or Return to Live) to continue live from here.", 6000);
          updateBar();
        } else if (!ok && live.canReturn) {
          live.canReturn = false;
          updateBar();
        }
      })
      .catch(() => {
        if (live.canReturn) {
          live.canReturn = false;
          updateBar();
        }
      });
  }
  if (S && lowTurnout() !== lastLow) updateBar();
}
let lastLow = false;
/** Voting has been open 45 s with fewer than 10 votes (Live only). */
function lowTurnout() {
  if (!live.on || !S || S.phase !== "ask") return (lastLow = false);
  const at = openedAt[slotOf()];
  return (lastLow = !!at && Date.now() - at > LOW_TURNOUT.afterMs && tallyOf(slotOf()).n < LOW_TURNOUT.votes && !S.manual[slotOf()]);
}
function connectWS() {
  if (!live.on) return;
  try {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws?role=presenter`);
    live.ws = ws;
    ws.onopen = () => {
      live.wsOpen = true;
      live.fails = 0;
      live.lastOk = Date.now();
      updateBar();
      clearInterval(live.pingTimer);
      live.pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 2000); // keeps lastOk fresh
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
      updateBar();
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
      if (!r.ok) throw new Error(r.status);
      live.fails = 0;
      live.lastOk = Date.now();
      applyServerState(await r.json());
    } catch {
      live.fails++; // the watchdog switches to Host Mode after 5 s without any answer
    }
  }, 1000);
}
function applyServerState(st) {
  if (!st || !live.on) return;
  if (st.round !== S.round) {
    S.round = st.round;
    S.tallies = {};
  }
  if (st.tally && st.slot === slotOf()) S.tallies[st.slot] = st.tally;
  if (typeof st.riders === "number") live.riders = st.riders;
  if (Array.isArray(st.words)) S.liveWords = st.words;
  if (typeof st.pending === "number") S.pending = st.pending;
  if (typeof st.languages === "number") S.languages = st.languages;
  // A round timer started here in the last few seconds wins over a server that hasn't heard of it yet
  const fresh = S.timer.endsAt && Date.now() - (S.timer.startedAt || 0) < 4000;
  if (st.timer && !(fresh && !st.timer.running)) {
    const endsAt = st.timer.running ? Date.now() + st.timer.remainingMs : null;
    if (!!endsAt !== !!S.timer.endsAt || Math.abs((endsAt || 0) - (S.timer.endsAt || 0)) > 1500) S.timer = { ...S.timer, endsAt, duration: st.timer.duration };
  }
  save();
  updateResults();
  if (S.phase === "lobby") setCount($("#ridersCount"), live.riders);
  updateBar();
  renderTimer();
  announce();
}
function desired() {
  const id = item().id;
  switch (S.phase) {
    case "lobby": return { slot: R[0].id, phase: "idle" };
    case "arrive":
    case "hurdle": return { slot: id, phase: "arrive" };
    case "ask": return { slot: slotOf(), phase: S.closed[slotOf()] ? "closed" : "open" };
    case "reveal": return { slot: slotOf(), phase: heldHere() ? "closed" : "reveal" }; // a held viewpoint keeps its answers hidden on phones
    case "info":
    case "card": return { slot: id, phase: "info" };
    case "summary": return { slot: R[last].id, phase: "end" };
  }
  return { slot: id, phase: "idle" };
}
let seqN = 0;
function syncServer(override) {
  const want = { ...(override || desired()), seq: Date.now() * 1000 + (seqN++ % 1000) };
  live.chain = live.chain.then(async () => {
    if (!live.on) return;
    try {
      const r = await adminCall({ action: "set", slot: want.slot, phase: want.phase, seq: want.seq });
      if (r.status === 401) return fallbackToHost("Server rejected the PIN. Using Host Mode (press L).");
      if (!r.ok) throw new Error(r.status);
      live.fails = 0;
      live.lastOk = Date.now();
      applyServerState(r.data.state);
      if (live.pendingTimer) {
        const duration = live.pendingTimer;
        live.pendingTimer = null;
        const t = await adminCall({ action: "timer", cmd: "start", duration });
        if (t.ok) applyServerState(t.data.state);
      }
    } catch {
      live.fails++;
      setTimeout(() => live.on && syncServer(), 1500); // the watchdog handles a server that stays away
    }
  });
}

// ------------------------------------------------------------------ input
function act(name) {
  switch (name) {
    case "next": return next();
    case "back": return back();
    case "reveal": return reveal();
    case "closeVote": return toggleVote();
    case "word": return addWord(0);
    case "wordNever": return addWord(1);
    case "timer": return setTimer(timerRunning() ? "stop" : "start");
    case "reset": return resetGame();
    case "mode": return live.on ? fallbackToHost("Host Mode: enter the room's result with the keyboard.") : enableLive(false);
    case "returnLive": return enableLive(false);
  }
}
document.querySelectorAll("#bar button").forEach((b) => b.addEventListener("click", (e) => (e.currentTarget.blur(), act(b.dataset.act))));
addEventListener("keydown", (e) => {
  if (modalOpen || e.ctrlKey || e.metaKey || e.altKey || !S) return;
  const k = e.key;
  const map = { ArrowRight: "next", " ": "next", PageDown: "next", Enter: "next", ArrowLeft: "back", PageUp: "back", Backspace: "back", r: "reveal", R: "reveal", v: "closeVote", V: "closeVote", t: "timer", T: "timer", l: "mode", L: "mode", w: "word", W: "word", n: "wordNever", N: "wordNever" };
  if (k === "f" || k === "F") return e.preventDefault(), document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.().catch(() => {});
  if (k === "h" || k === "H") return e.preventDefault(), document.body.classList.toggle("bar-hidden");
  if (k === "ArrowUp" || k === "ArrowDown") return e.preventDefault(), adjustPct(k === "ArrowUp" ? 10 : -10);
  if (/^[1-9]$/.test(k)) return e.preventDefault(), enter(Number(k) - 1);
  if (k === "0") return e.preventDefault(), enter(-1);
  if (/^[a-dA-D]$/.test(k)) return e.preventDefault(), enter(k.toUpperCase().charCodeAt(0) - 65);
  if (map[k]) {
    e.preventDefault();
    act(map[k]);
  }
});

window.__ride = { get state() { return S; }, get live() { return live; }, get route() { return R; }, stats, screenId: () => screenId(), slot: () => slotOf(), resultFor: (i, s) => resultFor(i, s), fuel: () => fuel() };
init();
