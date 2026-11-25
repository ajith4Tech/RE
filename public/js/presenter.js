/* The Ride — projector. "The Highway" edition.
 * The route is a list of questions and pitstops (content/en.json → route).
 * Phases: intro → arrive → ask → reveal (→ ask next sub-round …) or info → ride → … → summary
 * Everything is saved in localStorage, so a reload or a live AI demo resumes exactly.
 * The moderator view follows via BroadcastChannel (same laptop, offline) and the server.
 */
import { LANGUAGES, langMeta, tr, gapsFor, choicesFor } from "./i18n.js";
import { buildBand, portrait, PIT_ICONS } from "./scenery.js";
import { isProfane } from "./profanity.js";

const $ = (s) => document.querySelector(s);
const STORE = "ride.state.v3";
const PIN_KEY = "ride.pin";
const RIDE_MS = 2600;
const LETTERS = "ABCDEFGH";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("the-ride") : null;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let en, R, last, band;
const FILES = {}; // language code → translation file
let S;
let busy = false;
let armed = 0;
let sceneKey = "";
const live = { on: false, ws: null, wsOpen: false, pollTimer: null, pingTimer: null, reconnectTimer: null, fails: 0, chain: Promise.resolve() };

const fresh = (mode = "host") => ({
  i: 0, sub: 0, phase: "intro",
  manual: {}, final: {}, closed: {}, tallies: {}, stamps: {},
  words: [], liveWords: [], pending: 0, languages: 0,
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
const hasSubs = (it) => it.kind === "pitstop" && (it.pitType === "viewpoint" || it.pitType === "checkpost");
const subCount = (it) => (it.pitType === "viewpoint" ? it.showcases.length : it.pitType === "checkpost" ? it.rounds.length : 1);
const slotOf = (i = S.i, sub = S.sub) => (hasSubs(R[i]) ? `${i}.${sub}` : `${i}`);
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
  const slot = slotOf(i, sub);
  const m = S.manual[slot] || {};
  const t = tallyOf(slot);
  const r = { has: false, correct: null, delta: 0, text: "" };
  const ids = (list) => list.map((o) => o.id);
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
        if (it.scored && fin.correct === false) f -= cfg("fuelPenalty", 15);
      } else f += fin.delta || 0;
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
  R = en.route;
  last = R.length - 1;
  await Promise.all(
    LANGUAGES.filter((l) => l.code !== "en").map(async (l) => {
      try { FILES[l.code] = await (await fetch(`content/${l.code}.json`, { cache: "no-store" })).json(); } catch {}
    })
  );
  try {
    await Promise.all(["800 40px Signage", "700 40px Painted", "700 30px Atkinson", "30px Atkinson"].map((f) => document.fonts.load(f)));
  } catch {}
  band = buildBand($("#band"), R, short);
  S = loadState();
  $("#logSlots").innerHTML = R.map((it, i) => (it.kind === "pitstop" ? `<div class="slot" data-i="${i}" title="${esc(it.place)}"></div>` : "")).join("");
  renderLog(null);
  render();
  setInterval(tick, 250);
  const wantLive = new URLSearchParams(location.search).get("mode") === "live" || S.mode === "live";
  S.mode = "host";
  if (wantLive && location.protocol.startsWith("http")) enableLive(true);
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
  return R[0].place;
}

function render() {
  const it = item();
  $("#hudKind").textContent = S.phase === "intro" ? "Start" : S.phase === "summary" ? "Journey's end" : it.kind === "question" ? `Question ${qNumber(S.i)} of ${totalQ()}` : `Pitstop · ${it.place}`;
  $("#hudPlace").textContent = it.kind === "question" ? short(it.place) : `Near ${short(nearestPlace(S.i))}`;
  if (!busy) {
    setKm(it.km);
    band.setStop(S.i);
  }
  renderFuel();
  const shortBand = ["ask", "reveal", "summary"].includes(S.phase) || (S.phase === "info" && it.pitType === "mechanic");
  $("#stage").classList.toggle("band-short", shortBand && !busy);
  $("#stage").classList.toggle("band-tall", !shortBand || busy);

  const key = [S.i, S.sub, S.phase, live.on].join("|");
  if (key !== sceneKey) {
    sceneKey = key;
    $("#scene").innerHTML =
      S.phase === "intro" ? introHTML() :
      S.phase === "summary" ? summaryHTML() :
      it.kind === "question" ? (S.phase === "arrive" ? arriveQ(it) : askQ(it)) :
      pitHTML(it);
    if (S.phase === "intro" && live.on) makeQR($("#qrBig"), voteUrl());
    jitterPaint();
    lastAlt = lastCycle = performance.now();
  }
  updateResults();
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
  if (!over()) return;
  inner.classList.add("compact");
  let z = 1;
  while (answers && over() && z > 0.7) answers.style.zoom = (z -= 0.04).toFixed(2);
  let z2 = 1;
  while (left && over() && z2 > 0.76) left.style.zoom = (z2 -= 0.04).toFixed(2);
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
function introHTML() {
  const qr = live.on ? `<div class="qr-panel enter-2"><div class="qr" id="qrBig"></div><b>Ride along on your phone</b><span>${esc(shortUrl())}</span></div>` : "";
  return `<div class="intro">
    <div class="signboard enter">
      <h1>${esc(en.title)}</h1>
      <h2>${esc(en.subtitle)}</h2>
      <p>${esc(en.intro)}</p>
      ${rl("intro", ["kn"])}
      ${live.on ? "" : `<div class="cta">Hands up at every stop. Press <kbd>→</kbd> to start.</div>`}
    </div>${qr}</div>`;
}

function tagHTML(it, size = 150) {
  return `<div class="tag grain enter">
    <div class="tag-grid"><div class="pic">${portrait(it.portrait, size)}</div>
    <div><div class="tag-name">${esc(it.personaName)}</div><div class="tag-role">${esc(it.role)}</div><div class="tag-org">${esc(it.orgType)}</div></div></div></div>`;
}
const shiftHTML = (it) => `<div class="shift enter"><b>SHIFT</b><span>${esc(it.shift)}</span></div>`;

function arriveQ(it) {
  const p = `route.${it.id}`;
  const welcomes = regionLangs(it)
    .filter((c) => tr(FILES[c], `${p}.welcome`))
    .map((c) => `<div class="stone-welcome" lang="${c}" dir="${langMeta(c).dir}">${esc(tr(FILES[c], `${p}.welcome`))}</div>`)
    .join("");
  return `<div class="arrive">
    <div class="stone grain enter"><div class="stone-top"><div class="stone-place">${esc(short(it.place))}</div></div>
      <div class="stone-km">${it.km.toLocaleString("en-IN")} <small>km</small></div>${welcomes}<div class="stone-en">${esc(it.welcome)}</div></div>
    <div class="arrive-right">${tagHTML(it, 190)}${shiftHTML(it)}<div class="slip grain enter-3">${esc(it.scenario)}</div></div></div>`;
}

function askQ(it) {
  const p = `route.${it.id}`;
  const L = regionLangs(it);
  const isFinal = S.i === last;
  const cycleLangs = (cfg("finalCycleLanguages", []) || []).filter((c) => c !== "en");
  const qLine = isFinal ? rl(`${p}.question`, cycleLangs, "cycle") : rl(`${p}.question`, L);
  return `<div class="ask ${S.phase === "reveal" ? "revealed" : ""}">
    <div class="ask-left">${tagHTML(it, 120)}<div class="slip grain">${esc(it.scenario)}</div></div>
    <div class="ask-main">
      ${shiftHTML(it)}
      <div class="signboard enter-2"><div class="q-en">${esc(it.question)}</div>${qLine}</div>
      <div class="answers enter-3">${answersHTML(it, p, L)}</div>
      ${revealHTML(it, p, L)}
    </div></div>`;
}

function signHTML(id, k, text, path, L, keyLabel) {
  return `<div class="dsign" data-o="${esc(id)}"><span class="key">${esc(keyLabel ?? LETTERS[k])}</span>
    <div><div class="flagbar"></div><div class="en">${esc(text)}</div>${rl(path, L, "opt")}<div class="meter hidden"><div class="track"><div class="fill"></div></div><div class="val"></div></div></div></div>`;
}

function answersHTML(it, p, L) {
  switch (it.type) {
    case "choose":
      return `<div class="dsigns ${it.options.length === 4 ? "two" : ""}">${it.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.options.${o.id}`, L)).join("")}</div>`;
    case "tapstep":
      return `<div class="dsigns steps two">${it.steps.map((o, k) => signHTML(o.id, k, o.text, `${p}.steps.${o.id}`, L, k + 1)).join("")}</div>`;
    case "pickn":
      return `<div class="dsigns steps two">${it.items.map((o, k) => signHTML(o.id, k, o.text, `${p}.items.${o.id}`, L, k + 1)).join("")}</div>`;
    case "rank":
      return `<div class="dsigns steps" id="rankList">${it.items.map((o, k) => signHTML(o.id, k, o.text, `${p}.items.${o.id}`, L, k + 1)).join("")}</div>`;
    case "checkpoint": {
      const gaps = gapsFor(it);
      let h = `<div class="pipe">`;
      it.steps.forEach((s, k) => {
        h += `<div class="pstep"><div class="n">STEP ${k + 1}</div><div class="en">${esc(s.text)}</div>${rl(`${p}.steps.${s.id}`, L, "opt")}</div>`;
        if (gaps[k]) h += `<div class="pgap" data-o="${gaps[k].id}"><div class="gate">HUMAN<br/>CHECK</div><span class="key">${k + 1}</span><div class="vbar"><div class="vfill"></div></div><div class="val"></div></div>`;
      });
      return h + `</div>`;
    }
    case "match":
      return `<table class="match"><thead><tr><th></th>${it.buckets.map((b) => `<th>${esc(b.text)}${rl(`${p}.buckets.${b.id}`, L, "opt")}</th>`).join("")}</tr></thead><tbody>${it.items
        .map((x, k) => `<tr><td class="item"><span class="key">${k + 1}</span>${esc(x.text)}${rl(`${p}.items.${x.id}`, L, "opt")}</td>${it.buckets.map((b) => `<td class="mcell" data-cell="${x.id}:${b.id}"><div class="shade"></div><span></span></td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    case "estimate":
      return `<div class="est"><div></div>${it.sliders.map((s) => `<div class="hd">${esc(s.text)}${rl(`${p}.sliders.${s.id}`, L, "opt")}</div>`).join("")}
        ${it.periods.map((per) => `<div class="row">${esc(per.text)}</div>${it.sliders.map((s) => `<div class="cell" data-cell="${per.id}_${s.id}"><div class="room"></div><div class="real"></div></div>`).join("")}`).join("")}</div>
        ${it.placeholder ? `<div class="est-note">${esc(it.placeholder)}</div>` : ""}`;
    case "wordcloud":
      return `<div class="cloud" id="cloud"></div>`;
  }
  return "";
}

function revealHTML(it, p, L) {
  if (S.phase !== "reveal") return `<div class="hint" id="hostHint"></div>`;
  const f = S.final[slotOf()] || {};
  let v;
  if (!it.scored) v = `<span class="verdict">${it.type === "wordcloud" ? "Your road ahead" : "No score here"}</span>`;
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
    <div class="board-kind">${esc(PIT_KIND[it.pitType] || it.place)}</div>
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
  if (it.pitType === "viewpoint") {
    const sc = it.showcases[S.sub];
    const img = sc.image ? `<img class="show-img" src="${esc(sc.image)}" alt="Screenshot of ${esc(sc.title)}"/>` : `<div class="show-blank">Your Tech4Good<br/>example goes here</div>`;
    return `<div class="pit ask-mode">${boardHTML(it, true)}
      <div class="show answers" style="margin-top:16px">
        <div class="show-card grain">${img}<div class="show-title">${esc(sc.title)} <small>(${S.sub + 1}/${it.showcases.length})</small></div>
          ${sc.url ? `<a class="show-link" href="${esc(sc.url)}" target="_blank" rel="noopener">Open the live site ↗</a>` : ""}
          ${sc.note && reveal ? `<div class="show-note">${esc(sc.note)}</div>` : ""}</div>
        <div class="polls">${it.polls
          .map((q) => `<div class="poll" data-poll="${q.id}"><h4>${esc(q.question)}${rl(`${p}.polls.${q.id}.question`, L, "opt")}</h4><div class="dsigns">${q.options.map((o, k) => signHTML(`${q.id}:${o.id}`, k, o.text, "", [], LETTERS[k])).join("")}</div></div>`)
          .join("")}</div></div></div>`;
  }
  if (it.pitType === "checkpost") {
    const rd = it.rounds[S.sub];
    return `<div class="pit ask-mode" style="padding-right:290px">${boardHTML(it, true)}
      <div class="round-no" style="margin-top:14px">Round ${S.sub + 1} of ${it.rounds.length} · ${esc(it.question)}</div>
      <div class="round-item enter-2">${esc(rd.text)}${rl(`${p}.rounds.${rd.id}`, L)}</div>
      <div class="answers"><div class="dsigns">${it.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.options.${o.id}`, L)).join("")}</div></div>
      ${reveal ? pitVerdict(it) : `<div class="hint" id="hostHint"></div>`}</div>`;
  }
  return `<div class="pit ask-mode">${boardHTML(it, true)}
    <div class="pit-q"><div class="signboard enter-2"><div class="q-en">${esc(it.poll.question)}</div>${rl(`${p}.poll.question`, L)}</div>
    <div class="answers"><div class="dsigns ${it.poll.options.length === 2 ? "two" : ""}">${it.poll.options.map((o, k) => signHTML(o.id, k, o.text, `${p}.poll.options.${o.id}`, L)).join("")}</div></div>
    ${reveal ? pitVerdict(it) : `<div class="hint" id="hostHint"></div>`}</div></div>`;
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
  const won = R.filter((it, i) => isScoredQ(it) && S.final[`${i}`]?.correct === true).length;
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
function setMeter(el, p, txt) {
  const m = el?.querySelector(".meter");
  if (!m) return;
  m.classList.toggle("hidden", txt == null);
  m.querySelector(".fill").style.width = `${p}%`;
  m.querySelector(".val").textContent = txt ?? "";
}

function updateResults() {
  const it = item();
  if (!["ask", "reveal"].includes(S.phase)) return;
  const slot = slotOf();
  const t = tallyOf(slot);
  const r = resultFor(S.i, S.sub);
  const rev = S.phase === "reveal";
  const m = S.manual[slot] || {};

  if (it.kind === "question") {
    switch (it.type) {
      case "choose":
      case "tapstep":
        document.querySelectorAll(".dsign").forEach((el) => {
          const id = el.dataset.o;
          setMeter(el, pct(t.counts[id] || 0, t.n), t.n ? `${pct(t.counts[id] || 0, t.n)}% · ${t.counts[id] || 0}` : null);
          el.classList.toggle("lead", r.choice === id);
          el.classList.toggle("best", rev && id === it.answer);
          setFlags(el, [...(rev && id === it.answer ? [["best", it.type === "tapstep" ? "✓ Went wrong here" : "✓ Right way"]] : []), ...(r.choice === id ? [["room", rev || m.choice ? "Room's pick" : "Leading"]] : [])]);
        });
        break;
      case "checkpoint":
        document.querySelectorAll(".pgap").forEach((el) => {
          const id = el.dataset.o;
          const p = pct(t.counts[id] || 0, t.n);
          el.querySelector(".vfill").style.height = `${p}%`;
          el.querySelector(".val").textContent = t.n ? `${p}%` : "";
          el.classList.toggle("best", rev && id === it.answer);
          el.querySelector(".flag")?.remove();
          if (r.choice === id) el.insertAdjacentHTML("beforeend", `<span class="flag room">${rev || m.choice ? "Room" : "Leading"}</span>`);
        });
        break;
      case "pickn":
        document.querySelectorAll(".dsign").forEach((el) => {
          const id = el.dataset.o;
          setMeter(el, pct(t.counts[id] || 0, t.n), t.n ? `${pct(t.counts[id] || 0, t.n)}%` : null);
          const picked = r.picks?.includes(id);
          el.classList.toggle("lead", !!picked);
          setFlags(el, [...(rev && it.decoys.includes(id) ? [["decoy", "✗ Decoy"]] : []), ...(picked ? [["room", `Room's top ${it.n}`]] : [])]);
        });
        break;
      case "rank": {
        const list = $("#rankList");
        document.querySelectorAll(".dsign").forEach((el) => {
          const id = el.dataset.o;
          const a = avgPos(t, id);
          setMeter(el, t.n ? ((it.items.length - a + 1) / it.items.length) * 100 : 0, t.n ? `avg position ${a.toFixed(1)}` : null);
          const flags = [];
          if (rev && id === it.firstItem) flags.push(["best", `✓ ${en.ui.lowestRisk}`]);
          if (rev && id === it.lastItem) flags.push(["best", `✓ ${en.ui.highestRisk}`]);
          if (r.order) flags.push(["room", `Room #${r.order.indexOf(id) + 1}`]);
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
            cell.querySelector(".shade").style.opacity = rowTotal ? (p / 100) * 0.9 : 0;
            cell.querySelector("span").textContent = rowTotal ? `${p}%` : r.map?.[x.id] === b.id ? "ROOM" : "";
            cell.classList.toggle("lead", r.map?.[x.id] === b.id);
            cell.classList.toggle("right", rev && it.answers[x.id] === b.id);
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
      case "wordcloud": {
        const words = live.on ? S.liveWords : S.words;
        const max = Math.max(1, ...words.map((w) => w.n));
        $("#cloud").innerHTML = words.length
          ? words.map((w) => `<span style="font-size:${34 + Math.round((w.n / max) * 50)}px">${esc(w.text)}</span>`).join("")
          : `<div class="cloud-empty">${live.on ? `Answers appear here once the moderator approves them${S.pending ? ` (${S.pending} waiting)` : ""}.` : "Call out your answers! Press W to add each one."}</div>`;
        break;
      }
    }
  } else if (it.pitType === "viewpoint") {
    const sc = it.showcases[S.sub];
    it.polls.forEach((q) => {
      const tot = q.options.reduce((s, o) => s + (t.counts[`${q.id}:${o.id}`] || 0), 0);
      const lead = majority(Object.fromEntries(q.options.map((o) => [o.id, t.counts[`${q.id}:${o.id}`] || 0])), q.options.map((o) => o.id));
      q.options.forEach((o) => {
        const el = document.querySelector(`.dsign[data-o="${q.id}:${o.id}"]`);
        const c = t.counts[`${q.id}:${o.id}`] || 0;
        setMeter(el, pct(c, tot), tot ? `${pct(c, tot)}%` : null);
        el.classList.toggle("best", rev && sc.answers[q.id] === o.id);
        setFlags(el, [...(rev && sc.answers[q.id] === o.id ? [["best", "✓ Real answer"]] : []), ...(lead === o.id ? [["room", "Room"]] : [])]);
      });
    });
  } else if (["petrol", "landslide", "checkpost"].includes(it.pitType)) {
    const answer = it.pitType === "checkpost" ? it.rounds[S.sub].answer : it.answer;
    document.querySelectorAll(".answers .dsign").forEach((el) => {
      const id = el.dataset.o;
      let p = pct(t.counts[id] || 0, t.n);
      let txt = t.n ? `${p}% · ${t.counts[id] || 0}` : null;
      if (it.pitType === "petrol" && m.pct != null) {
        p = id === "yes" ? m.pct : 100 - m.pct;
        txt = `${p}% (room estimate)`;
      }
      setMeter(el, p, txt);
      el.classList.toggle("lead", r.choice === id);
      el.classList.toggle("best", rev && answer === id);
      setFlags(el, [...(rev && answer === id ? [["best", "✓ Right way"]] : []), ...(r.choice === id ? [["room", "Room's pick"]] : [])]);
    });
  }
  const hint = $("#hostHint");
  if (hint) hint.textContent = live.on ? "" : hostHint(it);
  const qc = $("#qrCount");
  if (qc) qc.textContent = `${t.n} answer${t.n === 1 ? "" : "s"}${S.closed[slot] ? " · closed" : ""}`;
}

function hostHint(it) {
  if (it.kind === "question")
    return { choose: "Show of hands: A, B, C or D?", tapstep: "Show of hands: which step went wrong?", checkpoint: "Show of hands: which gap needs a human?", pickn: `Show of hands for each one. The room picks ${it.n}.`, rank: "Call out the order: lowest risk first.", match: "Show of hands: which bucket for each?", estimate: "Call out your guesses!", wordcloud: "Call out your answers!" }[it.type] || "";
  return { petrol: "Show of hands: who will try this?", landslide: "Show of hands: A, B or C?", checkpost: "Show of hands: where does it go?", viewpoint: "Guess out loud!" }[it.pitType] || "";
}

// ------------------------------------------------------------------ Host Mode entry (also overrides live)
function entryHelp(it) {
  if (it.kind === "question")
    return { choose: "Keys A–D: room's majority", tapstep: `Keys 1–${it.steps?.length}: step the room picked`, checkpoint: "Keys 1–4: gap the room picked", pickn: `Keys 1–8: toggle the room's top ${it.n} · 0 clears`, rank: "Type the room's order 1–4, lowest risk first · 0 clears", match: "Keys 1–4: cycle that item's bucket · 0 clears", estimate: "Nothing to enter · R reveals", wordcloud: "W adds a word to the cloud" }[it.type];
  return { petrol: "↑ / ↓: % of the room saying Yes", landslide: "Keys A–C: room's majority", checkpost: "Keys A–C: room's majority", viewpoint: "Nothing to enter · R reveals, → next showcase", mechanic: "→ to ride on", chai: "→ to ride on" }[it.pitType];
}

function enter(index) {
  if (busy) return;
  const it = item();
  if (S.phase === "arrive" && hasQuestion(it)) {
    S.phase = "ask";
    if (it.pitType === "checkpost") autoTimer(it.seconds, "Round 1");
  }
  if (S.phase === "reveal") return toast("Press ← to undo the reveal before changing the room's result.");
  if (S.phase !== "ask") return;
  const slot = slotOf();
  if (index === -1) {
    delete S.manual[slot];
    return commit();
  }
  const m = (S.manual[slot] = { ...(S.manual[slot] || {}) });
  const kind = it.kind === "question" ? it.type : it.pitType;
  const choices = it.kind === "question" ? choicesFor(it) : it.pitType === "checkpost" ? it.options : it.poll?.options || [];
  switch (kind) {
    case "choose":
    case "tapstep":
    case "checkpoint":
    case "landslide":
    case "checkpost":
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
async function rideTo(target) {
  busy = true;
  const from = S.i;
  const t = R[target];
  const k0 = R[from].km;
  const k1 = t.km;
  $("#stage").classList.remove("band-short");
  $("#stage").classList.add("band-tall");
  $("#scene").innerHTML = `<div class="riding"><div class="next-sign"><small>${t.kind === "question" ? `Next · question ${qNumber(target)}` : "Pitstop ahead"}</small><b>${esc(t.kind === "question" ? short(t.place) : t.place)}</b><span>${Math.abs(k1 - k0)} km ${target > from ? "→" : "←"}</span></div></div>`;
  sceneKey = "";
  $("#qrCard").classList.add("hidden");
  $("#timerBox").classList.add("hidden");
  if (live.on) syncServer({ slot: `${target}`, phase: "arrive" });
  let lastFlap = 0;
  await band.ride(from, target, RIDE_MS, (e) => {
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
  S.timer = { endsAt: Date.now() + seconds * 1000, duration: seconds, label };
  if (live.on) adminCall({ action: "timer", cmd: "start", duration: seconds }).catch(() => {});
}

async function next() {
  if (busy) return;
  const it = item();
  switch (S.phase) {
    case "intro":
      S.phase = "arrive";
      break;
    case "arrive":
      if (hasQuestion(it)) {
        S.phase = "ask";
        S.sub = 0;
        if (it.pitType === "checkpost") autoTimer(it.seconds, "Round 1");
      } else {
        S.phase = "info";
        const before = fuel();
        if (it.pitType === "mechanic") S.final[slotOf()] = { delta: it.fuel.add };
        if (it.pitType === "chai") autoTimer(it.seconds, "Chai break");
        stamp(S.i);
        commit();
        flashFuel(before, fuel());
        return;
      }
      break;
    case "ask":
      return reveal();
    case "reveal":
      if (hasSubs(it) && S.sub < subCount(it) - 1) {
        S.sub++;
        S.phase = "ask";
        if (it.pitType === "checkpost") autoTimer(it.seconds, `Round ${S.sub + 1}`);
        break;
      }
    // falls through
    case "info":
      if (S.i < last) {
        S.timer = { endsAt: null, duration: S.timer.duration, label: "" };
        await rideTo(S.i + 1);
        S.i++;
        S.sub = 0;
        S.phase = "arrive";
      } else S.phase = "summary";
      break;
    default:
      return;
  }
  commit();
}

function reveal() {
  if (busy) return;
  const it = item();
  if (S.phase === "arrive" && hasQuestion(it)) return next();
  if (S.phase !== "ask") return;
  const r = resultFor(S.i, S.sub);
  const needs = (isScoredQ(it) || ["petrol", "landslide", "checkpost"].includes(it.pitType)) && !r.has;
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
  switch (S.phase) {
    case "summary":
      S.phase = "reveal";
      break;
    case "reveal":
      delete S.final[slot];
      if (it.kind === "pitstop") delete S.stamps[S.i];
      S.phase = "ask";
      break;
    case "info":
      delete S.final[slot];
      delete S.stamps[S.i];
      S.phase = "arrive";
      break;
    case "ask":
      if (hasSubs(it) && S.sub > 0) {
        S.sub--;
        S.phase = "reveal";
      } else S.phase = "arrive";
      break;
    case "arrive":
      if (S.i === 0) S.phase = "intro";
      else {
        await rideTo(S.i - 1);
        S.i--;
        const p = item();
        S.sub = subCount(p) - 1;
        S.phase = hasQuestion(p) ? "reveal" : "info";
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

async function addWord() {
  const it = item();
  if (it.type !== "wordcloud" || !["ask", "reveal"].includes(S.phase)) return;
  const text = await modal({ title: "Add to the word cloud", text: "Type an answer from the room (up to 40 characters).", input: true, inputType: "text", ok: "Add" });
  if (!text) return;
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 40);
  if (isProfane(clean)) return toast("That one was filtered. Try different words.");
  if (live.on) {
    try { await adminCall({ action: "addWord", text: clean }); } catch { toast("Couldn't reach the server."); }
    return;
  }
  const hit = S.words.find((w) => w.text.toLowerCase() === clean.toLowerCase());
  if (hit) hit.n++;
  else S.words.push({ text: clean, n: 1 });
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
}
function updateBar() {
  const it = item();
  $("#barWhere").textContent = S.phase === "intro" ? "Start" : it.kind === "question" ? `Q${qNumber(S.i)} ${short(it.place)}` : `${it.place}${hasSubs(it) ? ` ${S.sub + 1}/${subCount(it)}` : ""}`;
  $("#barMode").textContent = live.on ? (live.wsOpen ? "LIVE" : "LIVE (polling)") : "HOST";
  $("#barMode").classList.toggle("live", live.on);
  $("#barVotes").textContent = `${tallyOf(slotOf()).n} answers${S.pending ? ` · ${S.pending} words waiting` : ""}`;
  $("#barVotes").classList.toggle("hidden", !live.on);
  const res = ["ask", "reveal"].includes(S.phase) ? resultFor(S.i, S.sub).text : "";
  $("#barHint").textContent = S.phase === "ask" ? `${entryHelp(it) || ""}${res ? ` · now: ${res}` : ""}` : S.phase === "reveal" ? res : "";
  $("#btnClose").classList.toggle("hidden", !(live.on && S.phase === "ask"));
  $("#btnClose").textContent = S.closed[slotOf()] ? "Reopen vote" : "Close vote";
  $("#btnWord").classList.toggle("hidden", it.type !== "wordcloud" || !["ask", "reveal"].includes(S.phase));
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
  channel.postMessage({ type: "state", i: S.i, sub: S.sub, phase: S.phase, slot: slotOf(), mode: live.on ? "live" : "host", n: tallyOf(slotOf()).n, timer: S.timer, result: ["ask", "reveal"].includes(S.phase) ? resultFor(S.i, S.sub).text : "", words: S.words, at: Date.now() });
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
    live.on = true;
    live.fails = 0;
    S.mode = "live";
    $("#qrCard").dataset.url = "";
    connectWS();
    startPolling();
    commit();
    if (!silent) toast(`Live Vote on. Audience: ${shortUrl()}`);
    return;
  }
}
function fallbackToHost(msg) {
  const was = live.on;
  live.on = false;
  live.wsOpen = false;
  clearInterval(live.pollTimer);
  clearInterval(live.pingTimer);
  clearTimeout(live.reconnectTimer);
  if (live.ws) {
    live.ws.onclose = null;
    try { live.ws.close(); } catch {}
    live.ws = null;
  }
  S.mode = "host";
  for (const w of S.liveWords || []) if (!S.words.find((x) => x.text === w.text)) S.words.push(w); // keep approved words
  save();
  render();
  announce();
  if (msg) toast(msg, was ? 6000 : 4000);
}
function connectWS() {
  if (!live.on) return;
  try {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws?role=presenter`);
    live.ws = ws;
    ws.onopen = () => {
      live.wsOpen = true;
      live.fails = 0;
      updateBar();
      clearInterval(live.pingTimer);
      live.pingTimer = setInterval(() => ws.readyState === 1 && ws.send("ping"), 20000);
    };
    ws.onmessage = (ev) => {
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
      if (live.on) live.reconnectTimer = setTimeout(connectWS, 2000);
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
      applyServerState(await r.json());
    } catch {
      live.fails++;
      if (live.fails >= 3 && live.on) fallbackToHost("Live voting server unreachable. Switched to Host Mode; answers so far are kept. Press L to retry.");
    }
  }, 2000);
}
function applyServerState(st) {
  if (!st || !live.on) return;
  if (st.round !== S.round) {
    S.round = st.round;
    S.tallies = {};
  }
  if (st.tally && st.slot === slotOf()) S.tallies[st.slot] = st.tally;
  if (Array.isArray(st.words)) S.liveWords = st.words;
  if (typeof st.pending === "number") S.pending = st.pending;
  if (typeof st.languages === "number") S.languages = st.languages;
  if (st.timer) {
    const endsAt = st.timer.running ? Date.now() + st.timer.remainingMs : null;
    if (!!endsAt !== !!S.timer.endsAt || Math.abs((endsAt || 0) - (S.timer.endsAt || 0)) > 1500) S.timer = { ...S.timer, endsAt, duration: st.timer.duration };
  }
  save();
  updateResults();
  updateBar();
  renderTimer();
  announce();
}
function desired() {
  switch (S.phase) {
    case "intro": return { slot: "0", phase: "idle" };
    case "arrive": return { slot: `${S.i}`, phase: "arrive" };
    case "ask": return { slot: slotOf(), phase: S.closed[slotOf()] ? "closed" : "open" };
    case "reveal": return { slot: slotOf(), phase: "reveal" };
    case "info": return { slot: `${S.i}`, phase: "info" };
    case "summary": return { slot: `${last}`, phase: "end" };
  }
  return { slot: `${S.i}`, phase: "idle" };
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
      applyServerState(r.data.state);
    } catch {
      live.fails++;
      if (live.fails >= 3) return fallbackToHost("Live voting server unreachable. Switched to Host Mode. Press L to retry.");
      setTimeout(() => live.on && syncServer(), 1500);
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
    case "word": return addWord();
    case "timer": return setTimer(timerRunning() ? "stop" : "start");
    case "reset": return resetGame();
    case "mode": return live.on ? fallbackToHost("Host Mode: enter the room's result with the keyboard.") : enableLive(false);
  }
}
document.querySelectorAll("#bar button").forEach((b) => b.addEventListener("click", (e) => (e.currentTarget.blur(), act(b.dataset.act))));
addEventListener("keydown", (e) => {
  if (modalOpen || e.ctrlKey || e.metaKey || e.altKey || !S) return;
  const k = e.key;
  const map = { ArrowRight: "next", " ": "next", PageDown: "next", Enter: "next", ArrowLeft: "back", PageUp: "back", Backspace: "back", r: "reveal", R: "reveal", v: "closeVote", V: "closeVote", t: "timer", T: "timer", l: "mode", L: "mode", w: "word", W: "word" };
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

window.__ride = { get state() { return S; }, get live() { return live; }, resultFor: (i, s) => resultFor(i, s), fuel: () => fuel() };
init();
