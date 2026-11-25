/* The Ride — phones. "The Highway" edition.
 * Every format and pitstop, in the voter's language. One answer per phone per step
 * (random id in localStorage). Answers are sent as option ids, so all languages count together.
 * Accessibility: native controls where possible (radios, checkboxes, sliders, labels),
 * a polite live region for status, ≥ 48px targets, lang/dir on all translated text.
 */
import { LANGUAGES, langMeta, localize, fmt, tr, gapsFor, nestStrings, expandRoute } from "./i18n.js";
import { emblem } from "./scenery.js";
import { isProfane } from "./profanity.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (p) => String(p || "").split(",")[0];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const LETTERS = "ABCDEFGH";
const ARROW = `<svg viewBox="0 0 48 32" aria-hidden="true" focusable="false"><path d="M3 16 H40 M27 4 L42 16 L27 28" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const GRIP = `<svg viewBox="0 0 16 28" width="16" height="28" aria-hidden="true" focusable="false">${[4, 12].map((x) => [5, 14, 23].map((y) => `<circle cx="${x}" cy="${y}" r="2.6" fill="currentColor"/>`).join("")).join("")}</svg>`;
const TOLL = `<svg class="toll" viewBox="0 0 110 132" aria-hidden="true" focusable="false"><rect x="10" y="40" width="14" height="86" fill="#1A1A1A"/><rect x="0" y="122" width="34" height="10" fill="#1A1A1A"/><g class="boom"><rect x="17" y="44" width="90" height="14" rx="3" fill="#F5F1E6" stroke="#1A1A1A" stroke-width="3"/>${[30, 54, 78].map((x) => `<rect x="${x}" y="45.5" width="12" height="11" fill="#B5462B"/>`).join("")}</g><circle cx="17" cy="24" r="16" fill="#F2C230" stroke="#1A1A1A" stroke-width="4"/></svg>`;
const MILESTONE = `<svg class="v-ms" viewBox="0 0 120 140" aria-hidden="true"><path d="M10 136V60a50 50 0 0 1 100 0v76z" fill="#F5F1E6" stroke="#1A1A1A" stroke-width="6"/><path d="M10 60a50 50 0 0 1 100 0z" fill="#F2C230" stroke="#1A1A1A" stroke-width="6"/></svg>`;

let en = null;
let content = null;
let ER = []; // the English route, expanded: every step with its stop's place and persona
let crFor = null;
let CR = []; // the same, in the voter's language
/** The localized expanded route, rebuilt whenever the language (content) changes. */
const cr = () => (crFor === content ? CR : ((crFor = content), (CR = expandRoute(content))));
let lastSlot = null;
let lang = store.get("ride.lang");
let state = null;
let renderedKey = "";
let sending = false;
let pendingAnswer = null; // shown as selected while it is being sent
let pickingLanguage = false;
let otherNote = "";
const draft = {};
const FILES = {}; // regional files for the road strip
const aiCache = new Map();
let ws = null;
let wsOpen = false;
let backoff = 1500;

// ---------------------------------------------------------------- identity + memory
function voterId() {
  let id = store.get("ride.voter");
  if (!id) {
    id = crypto.getRandomValues ? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("") : (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, "");
    store.set("ride.voter", id);
  }
  return id;
}
const VOTER = voterId();
function memory() {
  try {
    const r = JSON.parse(store.get("ride.votes"));
    if (r && state && r.round === state.round) return r;
  } catch {}
  return { round: state?.round, v: {}, w: {} };
}
function remember(kind, slot, value) {
  const m = memory();
  m[kind] = m[kind] || {};
  m[kind][slot] = value;
  store.set("ride.votes", JSON.stringify(m));
}
const announce = (msg) => {
  const a = $("#announce");
  a.textContent = "";
  setTimeout(() => (a.textContent = msg), 50);
};

// ---------------------------------------------------------------- language
const isOther = () => typeof lang === "string" && lang.startsWith("other:");
const otherName = () => (isOther() ? lang.slice(6) : "");
const ui = () => content.ui;

async function loadFile(code) {
  if (!code || code === "en") return null;
  if (!(code in FILES)) {
    try { FILES[code] = await (await fetch(`/content/${code}.json`, { cache: "no-store" })).json(); } catch { FILES[code] = null; }
  }
  return FILES[code];
}

async function applyLanguage() {
  otherNote = "";
  const file = !isOther() ? await loadFile(lang) : null;
  content = localize(en, file);
  const meta = langMeta(isOther() ? "en" : lang || "en");
  document.documentElement.lang = isOther() ? "en" : lang || "en";
  document.documentElement.dir = meta.dir;
  if (isOther()) {
    await translateOther("ui");
    const it = currentItem();
    if (it) await translateOther(it.id);
  }
  $("#langBtn").setAttribute("aria-label", content.ui.changeLanguage);
  $("#foot").textContent = content.ui.anonymous;
  renderedKey = "";
  render();
}

async function translateOther(part) {
  const key = `${otherName()}|${part}`;
  if (!aiCache.has(key)) {
    try {
      const r = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: otherName(), part }) });
      if (!r.ok) throw new Error(r.status);
      aiCache.set(key, nestStrings((await r.json()).strings));
    } catch {
      aiCache.set(key, false);
    }
  }
  const merged = {};
  let ok = false;
  let fail = false;
  for (const [k, v] of aiCache) {
    if (!k.startsWith(otherName() + "|")) continue;
    if (v === false) fail = true;
    if (!v) continue;
    ok = true;
    if (v.ui) merged.ui = { ...(merged.ui || {}), ...v.ui };
    if (v.route) merged.route = { ...(merged.route || {}), ...v.route };
  }
  content = localize(en, merged);
  otherNote = (fail && aiCache.get(key) === false ? en.ui.translateFailed + " " : "") + (ok ? en.ui.aiTranslated : "");
  if (!ok && fail) otherNote = en.ui.translateFailed;
}

function languagePicker() {
  pickingLanguage = true;
  $("#road").classList.add("hidden");
  const otherOn = en.config?.otherLanguageAI !== false;
  app.innerHTML = `<section class="v-lang" aria-labelledby="lh">
    <h1 id="lh">${esc(en.ui.chooseLanguage)}</h1>
    <ul class="v-lang-grid">
      ${LANGUAGES.map((l) => `<li><button class="v-lang-btn" type="button" data-code="${l.code}" ${l.code === lang ? 'aria-current="true"' : ""}><b lang="${l.code}" dir="${l.dir}">${esc(l.nativeName)}</b><span>${esc(l.name)}</span></button></li>`).join("")}
      ${otherOn ? `<li><button class="v-lang-btn" type="button" data-code="other" ${isOther() ? 'aria-current="true"' : ""}><b>+</b><span>${esc(en.ui.otherLanguage)}</span></button></li>` : ""}
    </ul>
    <form class="v-other hidden" id="otherForm">
      <label for="otherInput">${esc(en.ui.typeLanguage)}</label>
      <div class="v-other-row"><input id="otherInput" maxlength="40" autocomplete="off" value="${esc(otherName())}" placeholder="Konkani, Manipuri, Tulu…"/><button class="v-go" type="submit">${esc(en.ui.go)}</button></div>
      <p class="v-count">${esc(en.ui.aiTranslated)}</p>
    </form></section>`;
  app.querySelectorAll(".v-lang-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.code === "other") {
        $("#otherForm").classList.remove("hidden");
        $("#otherInput").focus();
      } else chooseLanguage(b.dataset.code);
    })
  );
  $("#otherForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#otherInput").value.trim().replace(/\s+/g, " ");
    if (/^[\p{L}\p{M} ()'-]{2,40}$/u.test(name)) chooseLanguage(`other:${name}`);
  });
  app.querySelector(".v-lang-btn")?.focus();
}
function chooseLanguage(code) {
  lang = code;
  store.set("ride.lang", code);
  pickingLanguage = false;
  applyLanguage().then(() => app.focus());
}

// ---------------------------------------------------------------- helpers
// The step on screen comes from the slot, which is named by step id ("q3", "p4.1", "q1.m").
const idOf = () => String(state?.slot).split(".")[0];
function currentItem() {
  if (!state || !en) return null;
  const i = iOf();
  return i >= 0 ? cr()[i] : null;
}
const isMirror = () => String(state?.slot).endsWith(".m"); // a mirror poll after a question
const subOf = () => (isMirror() ? 0 : Number(String(state.slot).split(".")[1] || 0));
const qNumber = (i) => ER.slice(0, i + 1).filter((r) => r.kind === "question").length;
const iOf = () => ER.findIndex((r) => r.id === idOf());

async function renderRoad() {
  const box = $("#road");
  const it = currentItem();
  if (!it || !state || state.phase === "idle") return box.classList.add("hidden");
  const lines = [];
  for (const c of it.languages || []) {
    const f = await loadFile(c);
    const t = tr(f, `route.${it.id}.welcome`);
    if (t) lines.push(`<span lang="${c}" dir="${langMeta(c).dir}">${esc(t)}</span>`);
  }
  if (!lines.length) return box.classList.add("hidden");
  box.innerHTML = `<small>${esc(ui().roadLanguage)}</small>${lines.join(" · ")}`;
  box.classList.remove("hidden");
}

function setConn(ok, key) {
  $("#conn").className = "v-conn " + (ok ? "ok" : "bad");
  $("#connText").textContent = content ? content.ui[key] : "";
}

function bars(rows) {
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  return `<div class="v-bars" role="list">${rows
    .map((r) => {
      const p = Math.round((r.n / total) * 100);
      return `<div class="v-bar" role="listitem"><span>${esc(r.label)}</span><div class="v-track" aria-hidden="true"><div class="v-fill" style="width:${p}%"></div></div><span>${p}%</span></div>`;
    })
    .join("")}</div>`;
}

// ---------------------------------------------------------------- render
function render(force) {
  if (!content || pickingLanguage) return;
  renderRoad();
  if (!state) {
    app.innerHTML = `<div class="v-wait">${MILESTONE}<p class="v-big">${esc(ui().connecting)}</p></div>`;
    return;
  }
  const it = currentItem();
  const slot = String(state.slot);
  const mem = memory();
  const mine = mem.v?.[slot];
  const words = mem.w?.[slot] || 0;
  const key = JSON.stringify([slot, state.phase, state.round, mine, words, sending, otherNote, lang, state.phase === "open" ? 0 : state.tally?.n]);
  if (key === renderedKey && !force) return;
  renderedKey = key;
  const note = otherNote ? `<p class="v-ai">${esc(otherNote)}</p>` : "";
  const ph = state.phase;

  if (!it || ph === "idle" || it.kind === "intro") {
    app.innerHTML = `${note}<div class="v-wait">${MILESTONE}<h1 class="v-big">${esc(content.title)}</h1><p class="v-sub">${esc(content.subtitle)}</p><p class="v-sub">${esc(ui().waitingTitle)}. ${esc(ui().waitingBody)}</p></div>`;
    return;
  }
  if (ph === "end") {
    app.innerHTML = `${note}<div class="v-wait">${MILESTONE}<h1 class="v-big">${esc(ui().endTitle)}</h1><p class="v-closing">${esc(content.closingLine)}</p><p class="v-sub">${esc(ui().thanks)}</p></div>`;
    return;
  }

  if (it.kind === "card") {
    // Info card: shown while the projector is on it, no vote
    const link = it.link?.url ? `<a class="v-link" href="${esc(it.link.url)}" target="_blank" rel="noopener">${esc(ui().openLink)} ↗</a>` : "";
    app.innerHTML = `${note}<div class="v-board viewpoint"><b>${esc(it.title)}</b></div>
      ${it.rows ? `<table class="v-tokens">${it.rows.map((r) => `<tr><td>${esc(r.from)}</td><td aria-hidden="true">→</td><td class="tok">${esc(r.to)}</td></tr>`).join("")}</table>` : ""}
      <p class="v-scenario">${esc(it.text)}</p>${link}<p class="v-note">${esc(ui().lookUp)}</p>`;
    return;
  }
  let head;
  if (it.kind === "question") {
    const who = [it.role, it.orgType].filter(Boolean).map(esc).join(" · ");
    head = `<p class="v-kicker">${esc(fmt(ui().questionN, { n: qNumber(iOf()) }))} · ${esc(it.milestone || short(it.place))}</p>
      <div class="v-tag"><div class="pic">${emblem(ER[iOf()].emblem, 64, it.id)}</div><div><b>${esc(it.personaName)}</b>${who ? `<span>${who}</span>` : ""}</div>${it.voice ? `${ph === "arrive" ? `<i class="v-voice">“${esc(it.voice)}”</i>` : ""}` : ""}</div>
      ${isMirror() ? `<p class="v-shift"><b>${esc(ui().mirror)}</b></p>` : it.shift ? `<p class="v-shift"><b>${esc(ui().shift)}</b>${esc(it.shift)}</p>` : ""}`;
  } else {
    head = `<p class="v-kicker">${esc(ui().pitstop)} · ${esc(it.place)}</p><div class="v-board ${ER[iOf()].pitType}"><b>${esc(it.board)}</b></div>`;
  }

  if (ph === "arrive") {
    app.innerHTML = `${note}${head}${it.kind === "question" && it.scenario ? `<p class="v-scenario">${esc(it.scenario)}</p>` : ""}<p class="v-note">${esc(it.kind === "question" ? ui().questionSoon : ui().lookUp)}</p>`;
    return;
  }
  if (ph === "info") {
    const extra = it.tips ? `<ol class="v-tips">${it.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : it.prompt ? `<p class="v-q">${esc(it.prompt)}</p>` : "";
    app.innerHTML = `${note}${head}${extra}<p class="v-note">${esc(ui().lookUp)}</p>`;
    return;
  }

  // open / closed / reveal
  const q = questionBlock(it);
  let body = "";
  const cloud = (it.type === "wordcloud" || it.type === "dualcloud") && !isMirror(); // a mirror after a cloud is a normal poll
  const counted = `<p class="v-note good v-locked" role="status">${esc(ui().voteCounted)} <span>${esc(ui().lookUp)}</span></p>`;
  if (cloud) {
    if (ph === "open" && (it.type === "wordcloud" ? words < 3 : !words)) body = votingUI(it, words);
    else if (words) body = `<p class="v-note good" role="status">${esc(it.type === "dualcloud" ? ui().dualSent : ui().wordSent)}</p>`;
  } else if (ph === "open" && mine === undefined) body = votingUI(it, words);
  else if (mine !== undefined && ph !== "reveal") body = votingUI(it, words, mine) + counted; // locked: what you picked stays on screen
  else if (mine !== undefined) body = counted;
  if (ph === "closed") body += `<p class="v-note">${esc(ui().votingClosed)}</p>`;
  if (ph === "reveal") body += revealBlock(it);
  app.innerHTML = `${note}${head}${q}${body}`;
  wire(it);
}

function questionBlock(it) {
  if (it.kind === "question" && isMirror()) return `<h1 class="v-q" id="qh">${esc(it.mirror.question)}</h1>`;
  if (it.kind === "question") return `${it.scenario ? `<p class="v-scenario">${esc(it.scenario)}</p>` : ""}<h1 class="v-q" id="qh">${esc(it.question)}</h1>`;
  const t = ER[iOf()].pitType;
  if (t === "viewpoint") {
    const sc = it.showcases[subOf()];
    return `<div class="v-show">${sc.image ? `<img src="/${esc(sc.image)}" alt="${esc(sc.title)}"/>` : ""}<b>${esc(sc.title)}</b>${sc.url ? `<a href="${esc(sc.url)}" target="_blank" rel="noopener">${esc(ui().openSite)} ↗</a>` : ""}</div>`;
  }
  if (t === "checkpost") {
    const rd = it.rounds[subOf()];
    return `<p class="v-kicker">${esc(fmt(ui().roundN, { n: subOf() + 1, total: it.rounds.length }))}</p><h1 class="v-q" id="qh">${esc(it.question)} ${esc(rd.text)}</h1>`;
  }
  return `<h1 class="v-q" id="qh">${esc(it.poll.question)}</h1>`;
}

/** Options as sign-style buttons. `sel` is the picked id (shown green with a check); `locked` after voting. */
function optButtons(list, keyFn = (k) => LETTERS[k], { cls = "", sel, locked = false } = {}) {
  return `<div class="v-opts ${cls}" role="group" aria-labelledby="qh">${list
    .map((o, k) => {
      const on = sel === o.id;
      return `<button type="button" class="v-opt${on ? " mine" : ""}" data-a="${esc(o.id)}" aria-pressed="${on}" ${locked || sending ? "disabled" : ""}><span class="l" aria-hidden="true">${on ? "✓" : esc(keyFn(k))}</span><span class="t">${esc(o.text)}</span><span class="ar" aria-hidden="true">${ARROW}</span></button>`;
    })
    .join("")}</div>`;
}

function votingUI(it, words, lock) {
  const slot = String(state.slot);
  const locked = lock !== undefined;
  const fresh = () => ({ picks: [], order: [], match: {}, est: {}, polls: {}, text: "", parts: {} });
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const d = locked
    ? { ...fresh(), picks: Array.isArray(lock) ? lock : [], order: Array.isArray(lock) ? lock : [], match: obj(lock), est: obj(lock), polls: obj(lock) }
    : (draft[slot] = draft[slot] || fresh());
  const sel = locked ? lock : sending ? pendingAnswer : undefined;
  const dis = locked || sending ? "disabled" : "";
  const U = ui();
  const send = (label = U.submit, disabled = false) => (locked ? "" : `<div class="v-actions"><button type="button" class="v-go" data-act="send" ${disabled || sending ? "disabled" : ""}>${esc(sending ? U.sending : label)}</button></div>`);
  const help = (txt, id = "") => (locked ? "" : `<p class="v-help"${id ? ` id="${id}"` : ""}>${esc(txt)}</p>`);
  if (it.kind === "question" && isMirror()) return `${help(U.tapAnswer)}${optButtons(it.mirror.options, undefined, { sel, locked })}`;
  if (it.kind === "pitstop") {
    const t = ER[iOf()].pitType;
    if (t === "checkpost") return `${help(U.tapAnswer)}${optButtons(it.options, undefined, { sel, locked })}`;
    if (t === "viewpoint") {
      const all = it.polls.every((p) => d.polls[p.id]);
      return it.polls.map((p) => radioGroup(`poll-${p.id}`, p.question, p.options, d.polls[p.id], "signs", locked)).join("") + send(U.submit, !all);
    }
    return `${help(U.tapAnswer)}${optButtons(it.poll.options, undefined, { sel, locked })}`;
  }
  switch (it.type) {
    case "choose":
      return `${help(U.tapAnswer)}${optButtons(it.options, undefined, { sel, locked })}`;
    case "tapstep":
      return `${help(U.tapstepHelp)}${optButtons(it.steps, (k) => k + 1, { cls: "v-milestones", sel, locked })}`;
    case "checkpoint": {
      // Each gap is a toll barrier: tapping it lifts the boom (a human approves here) and sends the answer.
      const gaps = gapsFor(it);
      let h = `${help(U.checkpointHelp, "cph")}<ol class="v-pipe" aria-labelledby="${locked ? "qh" : "cph"}">`;
      it.steps.forEach((s, k) => {
        h += `<li class="st"><small>${esc(fmt(U.step, { n: k + 1 }))}</small>${esc(s.text)}</li>`;
        if (gaps[k]) {
          const on = sel === gaps[k].id;
          h += `<li class="v-gap"><button type="button" class="v-toll${on ? " lifted" : ""}" data-a="${gaps[k].id}" aria-pressed="${on}" ${dis}>${TOLL}<span>${on ? "✓ " : ""}${esc(fmt(U.gapLabel, { b: gaps[k].before.text }))}</span></button></li>`;
        }
      });
      return h + `</ol>`;
    }
    case "pickn": {
      const n = it.n;
      return `${help(fmt(U.pickHelp, { n }), "pkh")}
        <div class="v-opts v-chips" role="group" aria-labelledby="${locked ? "qh" : "pkh"}">${it.items
          .map((o, k) => {
            const on = d.picks.includes(o.id);
            return `<button type="button" class="v-opt${on ? " mine" : ""}" role="checkbox" aria-checked="${on}" data-pick="${o.id}" ${dis}><span class="l" aria-hidden="true">${on ? "✓" : k + 1}</span><span class="t">${esc(o.text)}</span></button>`;
          })
          .join("")}</div>
        ${locked ? "" : `<p class="v-count" aria-live="polite">${esc(fmt(U.picked, { k: d.picks.length, n }))}</p>`}${send(U.submit, d.picks.length !== n)}`;
    }
    case "rank": {
      // Tap items in order; the placed ones become stacked signs that can be dragged by the handle
      // (or moved with the arrow buttons / arrow keys) to change the order.
      const left = it.items.filter((x) => !d.order.includes(x.id));
      const last = d.order.length - 1;
      const row = (id, k) => {
        const text = it.items.find((x) => x.id === id).text;
        const tag = k === 0 ? `<small>${esc(U.lowestRisk)}</small>` : k === it.items.length - 1 ? `<small>${esc(U.highestRisk)}</small>` : "";
        if (locked) return `<li class="locked" data-id="${esc(id)}"><span class="n" aria-hidden="true">${k + 1}</span><span class="t">${esc(text)}${tag}</span></li>`;
        return `<li data-id="${esc(id)}"><button type="button" class="v-grip" data-grip="${esc(id)}" aria-label="${esc(`${k + 1}. ${text}. ${U.dragHelp}`)}">${GRIP}</button><span class="n" aria-hidden="true">${k + 1}</span><span class="t">${esc(text)}${tag}</span>
          <button type="button" class="v-move" data-move="-1" data-id="${esc(id)}" aria-label="${esc(`${U.moveUp}: ${text}`)}" ${k === 0 ? "disabled" : ""}>▲</button><button type="button" class="v-move" data-move="1" data-id="${esc(id)}" aria-label="${esc(`${U.moveDown}: ${text}`)}" ${k === last ? "disabled" : ""}>▼</button></li>`;
      };
      return `${help(U.rankHelp, "rkh")}${d.order.length > 1 && !locked ? `<p class="v-count">${esc(U.dragHelp)}</p>` : ""}
        <ol class="v-ranked" aria-label="${esc(U.rankHelp)}">${d.order.map(row).join("")}</ol>
        ${locked ? "" : `<div class="v-opts v-stackin" role="group" aria-labelledby="rkh">${left.map((x) => `<button type="button" class="v-opt" data-rank="${x.id}"><span class="l" aria-hidden="true">${d.order.length + 1}</span><span class="t">${esc(x.text)}</span><span class="ar" aria-hidden="true">${ARROW}</span></button>`).join("")}</div>
        <div class="v-actions"><button type="button" class="v-sec" data-act="clear" ${d.order.length ? "" : "disabled"}>${esc(U.startOver)}</button><button type="button" class="v-go" data-act="send" ${d.order.length === it.items.length && !sending ? "" : "disabled"}>${esc(sending ? U.sending : U.submit)}</button></div>`}`;
    }
    case "match":
      return `${help(U.matchHelp)}${it.items.map((x) => radioGroup(`m-${x.id}`, x.text, it.buckets, d.match[x.id], "lanes", locked)).join("")}${send(U.submit, it.items.some((x) => !d.match[x.id]))}`;
    case "estimate": {
      const fmtv = (s, v) => (s.format === "inr" ? "₹" + Number(v).toLocaleString("en-IN") : `${v}`);
      return `${help(U.estimateHelp)}${it.periods
        .map(
          (per) => `<section class="v-est" aria-labelledby="est-${per.id}"><h2 id="est-${per.id}">${esc(per.text)}</h2>${it.sliders
            .map((s) => {
              const id = `${per.id}_${s.id}`;
              const v = d.est[id] ?? Math.round((s.max - s.min) / (s.format === "inr" ? 4 : 3) / s.step) * s.step;
              if (!locked) d.est[id] = v;
              return `<div class="v-slider"><label for="r-${id}"><span>${esc(s.text)}</span><output id="o-${id}" for="r-${id}">${esc(fmtv(s, v))}</output></label>
                <input type="range" id="r-${id}" ${dis} data-est="${id}" data-fmt="${s.format}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-valuetext="${esc(fmtv(s, v))}"/></div>`;
            })
            .join("")}</section>`
        )
        .join("")}${send()}`;
    }
    case "wordcloud":
      return `<div class="v-word"><label for="word">${esc(U.wordHelp)}</label><input id="word" maxlength="40" autocomplete="off" value="${esc(d.text)}" aria-describedby="wc"/>
        <p class="v-count" id="wc" aria-live="polite">${esc(fmt(U.charsLeft, { n: 40 - [...d.text].length }))}</p></div>
        ${words ? `<p class="v-note good">${esc(U.wordSent)}</p>` : ""}${send(words ? U.wordAnother : U.submit, !d.text.trim())}`;
    case "dualcloud": {
      // Two short answers, either may be blank, one Submit button.
      const any = it.parts.some((pt) => (d.parts[pt.id] || "").trim());
      return `<p class="v-help">${esc(U.dualHelp)}</p>${it.parts
        .map((pt) => {
          const v = d.parts[pt.id] || "";
          return `<div class="v-part ${esc(pt.color)}"><label for="w-${pt.id}"><span class="v-ptag">${esc(pt.title)}</span>${esc(pt.text)}</label>
            <input id="w-${pt.id}" data-part="${pt.id}" maxlength="40" autocomplete="off" value="${esc(v)}" aria-describedby="wc-${pt.id}"/>
            <p class="v-count" id="wc-${pt.id}" aria-live="polite">${esc(fmt(U.charsLeft, { n: 40 - [...v].length }))}</p></div>`;
        })
        .join("")}${send(U.submit, !any)}`;
    }
  }
  return "";
}

/** style: "lanes" (match buckets as road lanes) or "signs" (viewpoint polls as sign buttons) */
function radioGroup(name, legend, options, checked, style = "", locked = false) {
  return `<fieldset class="v-group ${style}" ${locked ? "disabled" : ""}><legend>${esc(legend)}</legend><div class="v-radios">${options
    .map((o) => `<div class="v-radio"><input type="radio" name="${esc(name)}" id="${esc(name)}-${esc(o.id)}" value="${esc(o.id)}" ${checked === o.id ? "checked" : ""}/><label for="${esc(name)}-${esc(o.id)}"><span class="t">${esc(o.text)}</span></label></div>`)
    .join("")}</div></fieldset>`;
}

function revealBlock(it) {
  const U = ui();
  const t = state.tally || { n: 0, counts: {} };
  const rawIt = ER[iOf()];
  let ans = "";
  let rows = [];
  const txt = (list, id) => list.find((o) => o.id === id)?.text ?? id;
  if (it.kind === "question" && isMirror()) {
    rows = it.mirror.options.map((o) => ({ label: o.text, n: t.counts[o.id] || 0 }));
    return `<section class="v-reveal"><b class="h">${esc(U.noRightAnswer)}</b></section>${t.n ? bars(rows) : ""}`;
  }
  if (it.kind === "question") {
    switch (it.type) {
      case "choose": ans = it.answer ? `${it.answer}: ${txt(it.options, it.answer)}` : ""; rows = it.options.map((o) => ({ label: o.id, n: t.counts[o.id] || 0 })); break;
      case "tapstep": ans = `${fmt(U.step, { n: it.steps.findIndex((s) => s.id === it.answer) + 1 })}: ${txt(it.steps, it.answer)}`; rows = it.steps.map((o, k) => ({ label: fmt(U.step, { n: k + 1 }), n: t.counts[o.id] || 0 })); break;
      case "checkpoint": { const g = gapsFor(it).find((x) => x.id === it.answer); ans = fmt(U.gapLabel, { b: g.before.text }); rows = gapsFor(it).map((g2) => ({ label: g2.before.text, n: t.counts[g2.id] || 0 })); break; }
      case "pickn": ans = it.items.filter((x) => !rawIt.decoys.includes(x.id)).map((x) => x.text).join(", "); rows = it.items.map((x) => ({ label: x.text, n: t.counts[x.id] || 0 })); break;
      case "rank": ans = `${U.lowestRisk}: ${txt(it.items, it.firstItem)} · ${U.highestRisk}: ${txt(it.items, it.lastItem)}`; break;
      case "match": ans = it.items.map((x) => `${x.text} → ${txt(it.buckets, it.answers[x.id])}`).join(" · "); break;
      case "estimate": ans = `${it.periods[0].text}: ${it.answerText.then} · ${it.periods[1].text}: ${it.answerText.now}`; break;
      case "wordcloud":
      case "dualcloud": ans = ""; break;
    }
    return `<section class="v-reveal" aria-labelledby="rv">${ans ? `<b class="h" id="rv">${esc(U.answer)}</b><p>${esc(ans)}</p>` : `<b class="h" id="rv">${esc(U.noRightAnswer)}</b>`}<p>${esc(it.reveal)}</p></section>${rows.length && t.n ? bars(rows) : ""}`;
  }
  const pt = rawIt.pitType;
  if (pt === "viewpoint") {
    const sc = it.showcases[subOf()];
    ans = it.polls.map((p) => `${p.question} ${txt(p.options, sc.answers[p.id])}`).join(" · ");
  } else if (pt === "checkpost") {
    const rd = it.rounds[subOf()];
    ans = txt(it.options, rd.answer);
    rows = it.options.map((o) => ({ label: o.text, n: t.counts[o.id] || 0 }));
  } else if (pt === "landslide") {
    ans = txt(it.poll.options, it.answer);
    rows = it.poll.options.map((o) => ({ label: o.text, n: t.counts[o.id] || 0 }));
  } else {
    rows = it.poll.options.map((o) => ({ label: o.text, n: t.counts[o.id] || 0 }));
  }
  return `${ans ? `<section class="v-reveal"><b class="h">${esc(U.answer)}</b><p>${esc(ans)}</p></section>` : ""}${rows.length && t.n ? bars(rows) : ""}`;
}

function wire(it) {
  const slot = String(state.slot);
  const d = draft[slot];
  if (!d) return; // locked view: nothing to wire
  app.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => send(b.dataset.a)));
  app.querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.pick;
      if (d.picks.includes(id)) d.picks = d.picks.filter((x) => x !== id);
      else if (d.picks.length < it.n) d.picks.push(id);
      else return announce(fmt(ui().pickHelp, { n: it.n }));
      render(true);
      app.querySelector(`[data-pick="${id}"]`)?.focus();
    })
  );
  app.querySelectorAll("[data-rank]").forEach((b) =>
    b.addEventListener("click", () => {
      d.order.push(b.dataset.rank);
      announce(`${d.order.length}: ${it.items.find((x) => x.id === b.dataset.rank).text}`);
      render(true);
      (app.querySelector("[data-rank]") || app.querySelector('[data-act="send"]'))?.focus();
    })
  );
  app.querySelectorAll('input[type="radio"]').forEach((r) =>
    r.addEventListener("change", () => {
      if (r.name.startsWith("m-")) d.match[r.name.slice(2)] = r.value;
      if (r.name.startsWith("poll-")) d.polls[r.name.slice(5)] = r.value;
      const btn = app.querySelector('[data-act="send"]');
      const done = it.kind === "question" ? it.items.every((x) => d.match[x.id]) : it.polls.every((p) => d.polls[p.id]);
      if (btn) btn.disabled = !done;
    })
  );
  app.querySelectorAll("[data-est]").forEach((r) =>
    r.addEventListener("input", () => {
      const v = Number(r.value);
      d.est[r.dataset.est] = v;
      const text = r.dataset.fmt === "inr" ? "₹" + v.toLocaleString("en-IN") : String(v);
      $(`#o-${r.dataset.est}`).textContent = text;
      r.setAttribute("aria-valuetext", text);
    })
  );
  // rank: drag a handle, or use the arrow buttons / arrow keys, to reorder the placed items
  const moveTo = (id, delta) => {
    const k = d.order.indexOf(id);
    const j = k + delta;
    if (k < 0 || j < 0 || j >= d.order.length) return;
    d.order.splice(j, 0, d.order.splice(k, 1)[0]);
    announce(`${j + 1}: ${it.items.find((x) => x.id === id).text}`);
    render(true);
  };
  app.querySelectorAll("[data-move]").forEach((b) =>
    b.addEventListener("click", () => {
      moveTo(b.dataset.id, Number(b.dataset.move));
      const again = app.querySelector(`[data-move="${b.dataset.move}"][data-id="${b.dataset.id}"]:not(:disabled)`) || app.querySelector(`[data-grip="${b.dataset.id}"]`);
      again?.focus();
    })
  );
  app.querySelectorAll("[data-grip]").forEach((g) => {
    g.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      moveTo(g.dataset.grip, e.key === "ArrowUp" ? -1 : 1);
      app.querySelector(`[data-grip="${g.dataset.grip}"]`)?.focus();
    });
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const li = g.closest("li");
      const list = li.parentElement;
      g.setPointerCapture(e.pointerId);
      li.classList.add("dragging");
      const move = (ev) => {
        const after = [...list.children].filter((x) => x !== li).find((x) => ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
        if (after !== li.nextElementSibling) list.insertBefore(li, after || null);
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        li.classList.remove("dragging");
        d.order = [...list.children].map((x) => x.dataset.id);
        render(true);
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up, { once: true });
      g.addEventListener("pointercancel", up, { once: true });
    });
  });
  app.querySelectorAll("[data-part]").forEach((inp) =>
    inp.addEventListener("input", () => {
      d.parts[inp.dataset.part] = inp.value;
      $(`#wc-${inp.dataset.part}`).textContent = fmt(ui().charsLeft, { n: 40 - [...inp.value].length });
      app.querySelector('[data-act="send"]').disabled = !Object.values(d.parts).some((v) => v.trim());
    })
  );
  const word = $("#word");
  if (word)
    word.addEventListener("input", () => {
      d.text = word.value;
      $("#wc").textContent = fmt(ui().charsLeft, { n: 40 - [...word.value].length });
      app.querySelector('[data-act="send"]').disabled = !word.value.trim();
    });
  app.querySelector('[data-act="clear"]')?.addEventListener("click", () => {
    d.order = [];
    render(true);
  });
  app.querySelector('[data-act="send"]')?.addEventListener("click", () => {
    if (it.kind === "pitstop") return send({ ...d.polls });
    switch (it.type) {
      case "pickn": return send([...d.picks]);
      case "rank": return send([...d.order]);
      case "match": return send({ ...d.match });
      case "estimate": return send({ ...d.est });
      case "wordcloud": return sendWord(d.text);
      case "dualcloud": return sendDual(d.parts);
    }
  });
}

// ---------------------------------------------------------------- network
async function post(path, body) {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    } catch {
      await new Promise((res) => setTimeout(res, 800 + k * 700 + Math.random() * 400));
    }
  }
  return { status: 0, data: {} };
}
async function send(answer) {
  if (!state || state.phase !== "open" || sending || memory().v?.[state.slot] !== undefined) return;
  const slot = String(state.slot);
  sending = true;
  pendingAnswer = answer;
  render(true);
  const { status, data } = await post("/api/vote", { voter: VOTER, slot, answer, lang: lang || "en" });
  if (data.state) state = data.state;
  sending = false;
  pendingAnswer = null;
  if (status === 200 && data.ok) {
    remember("v", slot, data.answer ?? answer);
    announce(ui().voteRecorded);
    if (navigator.vibrate) navigator.vibrate(40);
  }
  render(true);
}
async function sendWord(text) {
  const slot = String(state.slot);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  if (isProfane(clean)) return announce(ui().wordRejected), alertNote(ui().wordRejected);
  sending = true;
  render(true);
  const { status, data } = await post("/api/word", { voter: VOTER, slot, text: clean, lang: lang || "en" });
  sending = false;
  if (status === 200 && data.ok) {
    remember("w", slot, data.count);
    draft[slot].text = "";
    announce(ui().wordSent);
  } else if (data.reason === "rephrase") {
    alertNote(ui().wordRejected);
    return;
  }
  render(true);
}
/** dualcloud: both parts in one request; blank parts are left out. */
async function sendDual(parts) {
  const slot = String(state.slot);
  const entries = Object.entries(parts)
    .map(([part, t]) => ({ part, text: String(t || "").replace(/\s+/g, " ").trim() }))
    .filter((e) => e.text);
  if (!entries.length) return;
  if (entries.some((e) => isProfane(e.text))) return announce(ui().wordRejected), alertNote(ui().wordRejected);
  sending = true;
  render(true);
  const { status, data } = await post("/api/word", { voter: VOTER, slot, entries, lang: lang || "en" });
  sending = false;
  if ((status === 200 && data.ok) || data.reason === "limit") {
    remember("w", slot, data.count || entries.length);
    draft[slot].parts = {};
    announce(ui().dualSent);
  } else if (data.reason === "rephrase") return alertNote(ui().wordRejected);
  render(true);
}
function alertNote(msg) {
  sending = false;
  render(true);
  app.insertAdjacentHTML("beforeend", `<p class="v-note" role="alert">${esc(msg)}</p>`);
}

async function applyState(st) {
  if (!st) return;
  const prev = state?.slot;
  state = st;
  if (String(st.slot) !== String(lastSlot)) {
    // A new step: forget drafts and any half-sent answer from the previous one, and keep the
    // "already voted" memory only for this step, so a phone never shows a cached earlier question.
    lastSlot = st.slot;
    for (const k of Object.keys(draft)) if (k !== String(st.slot)) delete draft[k];
    sending = false;
    pendingAnswer = null;
    const m = memory();
    for (const kind of ["v", "w"]) for (const k of Object.keys(m[kind] || {})) if (k !== String(st.slot)) delete m[kind][k];
    store.set("ride.votes", JSON.stringify(m));
    renderedKey = "";
  }
  if (isOther() && String(st.slot) !== String(prev)) {
    const it = currentItem();
    if (it) await translateOther(it.id);
    renderedKey = "";
  }
  render();
}
async function poll() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    await applyState(await r.json());
    if (!wsOpen) setConn(true, "connected");
  } catch {
    if (!wsOpen) setConn(false, "reconnecting");
  }
}
function connect() {
  try {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws?role=voter`);
  } catch {
    return setTimeout(connect, backoff);
  }
  ws.onopen = () => {
    wsOpen = true;
    backoff = 1500;
    setConn(true, "connected");
  };
  ws.onmessage = (ev) => {
    if (ev.data === "pong") return;
    try {
      const m = JSON.parse(ev.data);
      if (m.type === "state") applyState(m.state);
    } catch {}
  };
  ws.onclose = () => {
    wsOpen = false;
    setConn(false, "reconnecting");
    poll();
    setTimeout(connect, backoff + Math.random() * 1000); // jitter so 150 phones don't reconnect in lock-step
    backoff = Math.min(backoff * 1.6, 6000); // rejoin quickly; the voter id stays in localStorage
  };
}
setInterval(() => ws && ws.readyState === 1 && ws.send("ping"), 25000);
setInterval(() => !wsOpen && poll(), 4000 + Math.random() * 1500);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    poll();
    if (!ws || ws.readyState > 1) connect();
  }
});
$("#langBtn").addEventListener("click", () => {
  if (!en) return;
  if (pickingLanguage && lang) {
    pickingLanguage = false;
    renderedKey = "";
    render();
  } else languagePicker();
});

(async function init() {
  try {
    en = await (await fetch("/content/en.json", { cache: "no-store" })).json();
  } catch {
    app.innerHTML = `<div class="v-wait"><p class="v-big">Can't reach the game</p><p class="v-sub">Check your Wi-Fi or mobile data and reload.</p></div>`;
    return;
  }
  ER = expandRoute(en);
  content = localize(en, null);
  if (!lang) languagePicker();
  else await applyLanguage();
  await poll();
  connect();
})();

window.__vote = { get state() { return state; }, get lang() { return lang; }, dropConnection: () => ws?.close() }; // dropConnection: for the reconnect test
