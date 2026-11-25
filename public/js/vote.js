/* The Ride — phones. "The Highway" edition.
 * Every format and pitstop, in the voter's language. One answer per phone per step
 * (random id in localStorage). Answers are sent as option ids, so all languages count together.
 * Accessibility: native controls where possible (radios, checkboxes, sliders, labels),
 * a polite live region for status, ≥ 48px targets, lang/dir on all translated text.
 */
import { LANGUAGES, langMeta, localize, fmt, tr, gapsFor, nestStrings } from "./i18n.js";
import { portrait } from "./scenery.js";
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
const MILESTONE = `<svg class="v-ms" viewBox="0 0 120 140" aria-hidden="true"><path d="M10 136V60a50 50 0 0 1 100 0v76z" fill="#F5F1E6" stroke="#1A1A1A" stroke-width="6"/><path d="M10 60a50 50 0 0 1 100 0z" fill="#F2C230" stroke="#1A1A1A" stroke-width="6"/></svg>`;

let en = null;
let content = null;
let lang = store.get("ride.lang");
let state = null;
let renderedKey = "";
let sending = false;
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
function currentItem() {
  if (!state || !en) return null;
  const i = Number(String(state.slot).split(".")[0]);
  return en.route[i] ? content.route[i] : null;
}
const subOf = () => Number(String(state.slot).split(".")[1] || 0);
const qNumber = (i) => en.route.slice(0, i + 1).filter((r) => r.kind === "question").length;
const iOf = () => Number(String(state.slot).split(".")[0]);

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

  if (!it || ph === "idle") {
    app.innerHTML = `${note}<div class="v-wait">${MILESTONE}<h1 class="v-big">${esc(content.title)}</h1><p class="v-sub">${esc(content.subtitle)}</p><p class="v-sub">${esc(ui().waitingTitle)}. ${esc(ui().waitingBody)}</p></div>`;
    return;
  }
  if (ph === "end") {
    app.innerHTML = `${note}<div class="v-wait">${MILESTONE}<h1 class="v-big">${esc(ui().endTitle)}</h1><p class="v-closing">${esc(content.closingLine)}</p><p class="v-sub">${esc(ui().thanks)}</p></div>`;
    return;
  }

  let head;
  if (it.kind === "question") {
    head = `<p class="v-kicker">${esc(fmt(ui().questionN, { n: qNumber(iOf()) }))} · ${esc(short(it.place))}</p>
      <div class="v-tag"><div class="pic">${portrait(en.route[iOf()].portrait, 64)}</div><div><b>${esc(it.personaName)}</b><span>${esc(it.role)} · ${esc(it.orgType)}</span></div></div>
      <p class="v-shift"><b>${esc(ui().shift)}</b>${esc(it.shift)}</p>`;
  } else {
    head = `<p class="v-kicker">${esc(ui().pitstop)} · ${esc(it.place)}</p><div class="v-board ${en.route[iOf()].pitType}"><b>${esc(it.board)}</b></div>`;
  }

  if (ph === "arrive") {
    app.innerHTML = `${note}${head}${it.kind === "question" ? `<p class="v-scenario">${esc(it.scenario)}</p>` : ""}<p class="v-note">${esc(it.kind === "question" ? ui().questionSoon : ui().lookUp)}</p>`;
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
  if (ph === "open" && (mine === undefined || (it.type === "wordcloud" && words < 3))) body = votingUI(it, words);
  else if (mine !== undefined || words) body = `<p class="v-note good" role="status">${esc(it.type === "wordcloud" ? ui().wordSent : ui().voteRecorded)}</p>`;
  if (ph === "closed") body += `<p class="v-note">${esc(ui().votingClosed)}</p>`;
  if (ph === "reveal") body += revealBlock(it);
  app.innerHTML = `${note}${head}${q}${body}`;
  wire(it);
}

function questionBlock(it) {
  if (it.kind === "question") return `<p class="v-scenario">${esc(it.scenario)}</p><h1 class="v-q" id="qh">${esc(it.question)}</h1>`;
  const t = en.route[iOf()].pitType;
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

function optButtons(list, keyFn = (k) => LETTERS[k]) {
  return `<div class="v-opts" role="group" aria-labelledby="qh">${list
    .map((o, k) => `<button type="button" class="v-opt" data-a="${esc(o.id)}" ${sending ? "disabled" : ""}><span class="l" aria-hidden="true">${esc(keyFn(k))}</span><span>${esc(o.text)}</span></button>`)
    .join("")}</div>`;
}

function votingUI(it, words) {
  const slot = String(state.slot);
  const d = (draft[slot] = draft[slot] || { picks: [], order: [], match: {}, est: {}, polls: {}, text: "" });
  const U = ui();
  const send = (label = U.submit, disabled = false) => `<div class="v-actions"><button type="button" class="v-go" data-act="send" ${disabled || sending ? "disabled" : ""}>${esc(sending ? U.sending : label)}</button></div>`;
  if (it.kind === "pitstop") {
    const t = en.route[iOf()].pitType;
    if (t === "checkpost") return `<p class="v-help">${esc(U.tapAnswer)}</p>${optButtons(it.options)}`;
    if (t === "viewpoint") {
      const all = it.polls.every((p) => d.polls[p.id]);
      return it.polls.map((p) => radioGroup(`poll-${p.id}`, p.question, p.options, d.polls[p.id])).join("") + send(U.submit, !all);
    }
    return `<p class="v-help">${esc(U.tapAnswer)}</p>${optButtons(it.poll.options)}`;
  }
  switch (it.type) {
    case "choose":
      return `<p class="v-help">${esc(U.tapAnswer)}</p>${optButtons(it.options)}`;
    case "tapstep":
      return `<p class="v-help">${esc(U.tapstepHelp)}</p>${optButtons(it.steps, (k) => k + 1)}`;
    case "checkpoint": {
      const gaps = gapsFor(it);
      let h = `<p class="v-help" id="cph">${esc(U.checkpointHelp)}</p><ol class="v-pipe" aria-labelledby="cph">`;
      it.steps.forEach((s, k) => {
        h += `<li class="st"><small>${esc(fmt(U.step, { n: k + 1 }))}</small>${esc(s.text)}</li>`;
        if (gaps[k]) h += `<li class="v-gap"><button type="button" data-a="${gaps[k].id}" ${sending ? "disabled" : ""}>✋ ${esc(fmt(U.gapLabel, { b: gaps[k].before.text }))}</button></li>`;
      });
      return h + `</ol>`;
    }
    case "pickn": {
      const n = it.n;
      return `<p class="v-help" id="pkh">${esc(fmt(U.pickHelp, { n }))}</p>
        <div class="v-opts" role="group" aria-labelledby="pkh">${it.items
          .map((o, k) => `<button type="button" class="v-opt" role="checkbox" aria-checked="${d.picks.includes(o.id)}" data-pick="${o.id}"><span class="l" aria-hidden="true">${d.picks.includes(o.id) ? "✓" : k + 1}</span><span>${esc(o.text)}</span></button>`)
          .join("")}</div>
        <p class="v-count" aria-live="polite">${esc(fmt(U.picked, { k: d.picks.length, n }))}</p>${send(U.submit, d.picks.length !== n)}`;
    }
    case "rank": {
      const left = it.items.filter((x) => !d.order.includes(x.id));
      return `<p class="v-help" id="rkh">${esc(U.rankHelp)}</p>
        <ol class="v-ranked" aria-label="${esc(U.rankHelp)}">${d.order
          .map((id, k) => `<li><span class="n" aria-hidden="true">${k + 1}</span><span>${esc(it.items.find((x) => x.id === id).text)}</span>${k === 0 ? `<em>${esc(U.lowestRisk)}</em>` : k === it.items.length - 1 ? `<em>${esc(U.highestRisk)}</em>` : ""}</li>`)
          .join("")}</ol>
        <div class="v-opts" role="group" aria-labelledby="rkh">${left.map((x) => `<button type="button" class="v-opt" data-rank="${x.id}"><span class="l" aria-hidden="true">${d.order.length + 1}</span><span>${esc(x.text)}</span></button>`).join("")}</div>
        <div class="v-actions"><button type="button" class="v-sec" data-act="clear" ${d.order.length ? "" : "disabled"}>${esc(U.startOver)}</button><button type="button" class="v-go" data-act="send" ${d.order.length === it.items.length && !sending ? "" : "disabled"}>${esc(sending ? U.sending : U.submit)}</button></div>`;
    }
    case "match":
      return `<p class="v-help">${esc(U.matchHelp)}</p>${it.items.map((x) => radioGroup(`m-${x.id}`, x.text, it.buckets, d.match[x.id])).join("")}${send(U.submit, it.items.some((x) => !d.match[x.id]))}`;
    case "estimate": {
      const fmtv = (s, v) => (s.format === "inr" ? "₹" + Number(v).toLocaleString("en-IN") : `${v}`);
      return `<p class="v-help">${esc(U.estimateHelp)}</p>${it.periods
        .map(
          (per) => `<section class="v-est" aria-labelledby="est-${per.id}"><h2 id="est-${per.id}">${esc(per.text)}</h2>${it.sliders
            .map((s) => {
              const id = `${per.id}_${s.id}`;
              const v = d.est[id] ?? Math.round((s.max - s.min) / (s.format === "inr" ? 4 : 3) / s.step) * s.step;
              d.est[id] = v;
              return `<div class="v-slider"><label for="r-${id}"><span>${esc(s.text)}</span><output id="o-${id}" for="r-${id}">${esc(fmtv(s, v))}</output></label>
                <input type="range" id="r-${id}" data-est="${id}" data-fmt="${s.format}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" aria-valuetext="${esc(fmtv(s, v))}"/></div>`;
            })
            .join("")}</section>`
        )
        .join("")}${send()}`;
    }
    case "wordcloud":
      return `<div class="v-word"><label for="word">${esc(U.wordHelp)}</label><input id="word" maxlength="40" autocomplete="off" value="${esc(d.text)}" aria-describedby="wc"/>
        <p class="v-count" id="wc" aria-live="polite">${esc(fmt(U.charsLeft, { n: 40 - [...d.text].length }))}</p></div>
        ${words ? `<p class="v-note good">${esc(U.wordSent)}</p>` : ""}${send(words ? U.wordAnother : U.submit, !d.text.trim())}`;
  }
  return "";
}

function radioGroup(name, legend, options, checked) {
  return `<fieldset class="v-group"><legend>${esc(legend)}</legend><div class="v-radios">${options
    .map((o) => `<div class="v-radio"><input type="radio" name="${esc(name)}" id="${esc(name)}-${esc(o.id)}" value="${esc(o.id)}" ${checked === o.id ? "checked" : ""}/><label for="${esc(name)}-${esc(o.id)}">${esc(o.text)}</label></div>`)
    .join("")}</div></fieldset>`;
}

function revealBlock(it) {
  const U = ui();
  const t = state.tally || { n: 0, counts: {} };
  const rawIt = en.route[iOf()];
  let ans = "";
  let rows = [];
  const txt = (list, id) => list.find((o) => o.id === id)?.text ?? id;
  if (it.kind === "question") {
    switch (it.type) {
      case "choose": ans = `${it.answer}: ${txt(it.options, it.answer)}`; rows = it.options.map((o) => ({ label: o.id, n: t.counts[o.id] || 0 })); break;
      case "tapstep": ans = `${fmt(U.step, { n: it.steps.findIndex((s) => s.id === it.answer) + 1 })}: ${txt(it.steps, it.answer)}`; rows = it.steps.map((o, k) => ({ label: fmt(U.step, { n: k + 1 }), n: t.counts[o.id] || 0 })); break;
      case "checkpoint": { const g = gapsFor(it).find((x) => x.id === it.answer); ans = fmt(U.gapLabel, { b: g.before.text }); rows = gapsFor(it).map((g2) => ({ label: g2.before.text, n: t.counts[g2.id] || 0 })); break; }
      case "pickn": ans = it.items.filter((x) => !rawIt.decoys.includes(x.id)).map((x) => x.text).join(", "); rows = it.items.map((x) => ({ label: x.text, n: t.counts[x.id] || 0 })); break;
      case "rank": ans = `${U.lowestRisk}: ${txt(it.items, it.firstItem)} · ${U.highestRisk}: ${txt(it.items, it.lastItem)}`; break;
      case "match": ans = it.items.map((x) => `${x.text} → ${txt(it.buckets, it.answers[x.id])}`).join(" · "); break;
      case "estimate": ans = `${it.periods[0].text}: ${it.answerText.then} · ${it.periods[1].text}: ${it.answerText.now}`; break;
      case "wordcloud": ans = ""; break;
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
  render(true);
  const { status, data } = await post("/api/vote", { voter: VOTER, slot, answer, lang: lang || "en" });
  if (data.state) state = data.state;
  sending = false;
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
function alertNote(msg) {
  sending = false;
  render(true);
  app.insertAdjacentHTML("beforeend", `<p class="v-note" role="alert">${esc(msg)}</p>`);
}

async function applyState(st) {
  if (!st) return;
  const prev = state?.slot;
  state = st;
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
    backoff = Math.min(backoff * 1.6, 15000);
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
  content = localize(en, null);
  if (!lang) languagePicker();
  else await applyLanguage();
  await poll();
  connect();
})();

window.__vote = { get state() { return state; }, get lang() { return lang; } };
