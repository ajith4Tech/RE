/* The Ride — phones.
 * Always shows the step on the big screen. One answer per phone per step (a random id in localStorage);
 * every vote carries the step id, and anything cached from an earlier step is cleared when the step changes.
 * Accessibility: real buttons, a polite live region for status, ≥ 48px targets, inputs at 20px (no zoom).
 */
import { flatten, fmt, filled, isVote, isQuestion, isCloud, choicesOf, personaOf, milestoneParts, stopTotal } from "./route.js";
import { emblem } from "./scenery.js";
import { isProfane } from "./profanity.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const LETTERS = "ABCDEFGH";
const ARROW = `<svg viewBox="0 0 48 32" aria-hidden="true" focusable="false"><path d="M3 16 H40 M27 4 L42 16 L27 28" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const OUT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MILESTONE = `<svg class="v-ms" viewBox="0 0 120 140" aria-hidden="true" focusable="false"><path d="M10 136V60a50 50 0 0 1 100 0v76z" fill="#FFFFFF" stroke="#22252B" stroke-width="3"/><path d="M11.5 60a48.5 48.5 0 0 1 97 0z" fill="#2F6F62"/></svg>`;

let C = null;
let STEPS = [];
let state = null;
let lastSlot = null;
let renderedKey = "";
let sending = false;
let pendingAnswer = null; // shown as selected while it is being sent
let notice = ""; // a one-off message under the answers (send failed, rephrase, …)
const draft = {};
let ws = null;
let wsOpen = false;
let backoff = 1500;
const U = (k, vars) => fmt(C.ui[k], vars);

// ---------------------------------------------------------------- identity + memory (this step only)
function voterId() {
  let id = store.get("ride.voter");
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    store.set("ride.voter", id);
  }
  return id;
}
const VOTER = voterId();
function memory() {
  try {
    const r = JSON.parse(store.get("ride.votes"));
    if (r && state && r.round === state.round && r.slot === state.slot) return r;
  } catch {}
  return { round: state?.round, slot: state?.slot, v: undefined, w: 0 };
}
function remember(patch) {
  store.set("ride.votes", JSON.stringify({ ...memory(), ...patch }));
}
const announce = (msg) => {
  const a = $("#announce");
  a.textContent = "";
  setTimeout(() => (a.textContent = msg), 50);
};
function setConn(ok, key) {
  $("#conn").className = "v-conn " + (ok ? "ok" : "bad");
  $("#connText").textContent = C ? U(key) : "";
}

// ---------------------------------------------------------------- render
const current = () => (state ? STEPS.find((s) => s.id === state.slot) || null : null);
const stopOf = (s) => C.stops[s.stopIndex];
function personaTag(p, line = "") {
  if (!p) return "";
  return `<div class="v-tag"><div class="pic">${emblem(p.badge, 56)}</div><div><b>${esc(p.name)}</b><span>${esc(p.role)}</span></div>${line ? `<i class="v-voice">“${esc(line)}”</i>` : ""}</div>`;
}
const waitBlock = (title, sub = "") => `<div class="v-wait">${MILESTONE}<p class="v-big">${esc(title)}</p>${sub ? `<p class="v-sub">${esc(sub)}</p>` : ""}</div>`;
const watchNote = () => `<p class="v-note">${esc(U("watch"))}</p>`;
function kickerFor(s) {
  if (s.type === "intro") return U("beforeWeRide");
  const stop = stopOf(s);
  if (s.type === "pump") return U("refuel");
  const where = stop.arrival ? U("arrival") : U("stopN", { n: s.stopIndex + 1, total: stopTotal(C) });
  return isQuestion(s) ? `${where} · ${U("questionN", { n: s.qn, total: s.qTotal })}` : `${where} · ${stop.place}`;
}

function render(force) {
  if (!C) return;
  if (!state) {
    app.innerHTML = waitBlock(U("connecting"));
    return;
  }
  const s = current();
  const ph = state.phase;
  const mem = memory();
  const key = JSON.stringify([state.slot, ph, state.round, mem.v, mem.w, sending, notice]);
  if (key === renderedKey && !force) return patchLive();
  renderedKey = key;

  if (!s || ph === "idle") {
    app.innerHTML = waitBlock(C.lobby.phoneJoined);
    return;
  }
  if (ph === "arrive") {
    const stop = stopOf(s);
    const [head, sub] = milestoneParts(stop);
    const p = stop.persona ? { ...C.personas[stop.persona] } : null;
    app.innerHTML = `<p class="v-kicker">${esc(stop.arrival ? U("arrival") : U("stopN", { n: s.stopIndex + 1, total: stopTotal(C) }))}</p>
      <div class="v-board"><b>${esc(head)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}<small>${esc(stop.theme)} · ${stop.km.toLocaleString("en-IN")} km</small></div>
      ${personaTag(p, stop.voice)}${watchNote()}`;
    return;
  }
  const kicker = `<p class="v-kicker">${esc(kickerFor(s))}</p>`;
  if (!isVote(s) || (s.type === "showcase" && ph === "show")) {
    app.innerHTML = kicker + infoBlock(s);
    return;
  }

  // A vote: open / closed (locked) / reveal (Stop 1's answer)
  const p = personaOf(C, s);
  let body = "";
  const voted = mem.v !== undefined || mem.w > 0;
  const bars = liveRows(s) ? `<section class="v-live" aria-labelledby="lvh"><h2 class="v-live-h" id="lvh">${esc(s.type === "pump" && ph !== "open" ? s.resultLine : U("roomSoFar"))}</h2><div class="v-bars" id="liveBars" role="list"></div></section>` : "";
  if (ph === "open" && !voted) body = votingUI(s);
  else if (ph === "open" && isCloud(s) && s.format === "wordcloud" && mem.w < 3) body = `<p class="v-note good v-locked" role="status">${esc(U("wordSent"))}</p>${votingUI(s)}`;
  else {
    if (voted) body += `<p class="v-note good v-locked" role="status">${CHECK}<span>${esc(isCloud(s) ? (s.format === "dualcloud" ? U("dualSent") : mem.w >= 3 ? U("wordLimit") : U("wordSent")) : U("youreIn"))}</span></p>`;
    if (mem.v !== undefined) body += votingUI(s, mem.v);
    if (ph === "closed") body += `<p class="v-note">${esc(U("lockedNote"))}</p>`;
    if (ph === "reveal") body += `<p class="v-note v-reveal-note">${esc(s.phoneReveal)}</p>`;
    body += bars;
  }
  if (notice) body += `<p class="v-note v-alert" role="alert">${esc(notice)}</p>`;
  const cd = ph === "open" ? `<div class="v-cd" aria-hidden="true"><i></i></div>` : "";
  app.innerHTML = `${kicker}${p ? personaTag(p) : ""}<h1 class="v-q" id="qh">${esc(s.question)}</h1>${cd}${body}`;
  wire(s);
  patchLive();
}

/** Screens without a vote: the intro, Stop 1's websites, a reveal, a persona, an info card, the closing. */
function infoBlock(s) {
  switch (s.type) {
    case "intro":
      return `<h1 class="v-q">${esc(s.title)}</h1><p class="v-scenario">${esc(s.line)}</p><div class="v-board"><b>${esc(s.mission)}</b></div>${watchNote()}`;
    case "showcase":
      return `<h1 class="v-q">${esc(s.phoneLine)}</h1>${watchNote()}`;
    case "reveal":
      return `${personaTag(personaOf(C, s))}<section class="v-reveal">${s.takeaway ? `<p>${esc(s.text)}</p><p class="v-take">${esc(s.takeaway)}</p>` : `<p class="v-take">${esc(s.text)}</p>`}</section>${watchNote()}`;
    case "persona":
      return `${personaTag(personaOf(C, s), s.line)}${watchNote()}`;
    case "infocard": {
      const link = s.link && filled(s.link.url) ? `<a class="v-link" href="${esc(s.link.url)}" target="_blank" rel="noopener">${esc(U("openLink"))} ${OUT}</a>` : "";
      return `<div class="v-board"><b>${esc(s.title)}</b></div>
        ${s.rows ? `<table class="v-tokens">${s.rows.map((r) => `<tr><td>${esc(r.from)}</td><td class="arr" aria-hidden="true">${ARROW}</td><td class="tok">${esc(r.to)}</td></tr>`).join("")}</table>` : ""}
        <p class="v-scenario">${esc(s.text)}</p>${link}`;
    }
    case "closing":
      return `<p class="v-scenario">${esc(s.text)}</p><p class="v-closing">${esc(s.finalLine)}</p>`;
  }
  return watchNote();
}

/** Rows for the room's live result (choose, pick-n, pump), or null for word clouds. */
function liveRows(s) {
  if (isCloud(s)) return null;
  return choicesOf(s).map((o, k) => ({ id: o.id, label: s.format === "pickn" ? o.text : `${LETTERS[k]}. ${o.text}` }));
}
let lastVoteSig = "";
/** Fill the live bars and the countdown in place (no re-render, so inputs and focus stay put). */
function patchLive() {
  const box = $("#liveBars");
  const s = current();
  if (box && s) {
    const rows = liveRows(s) || [];
    const t = state.tally || { n: 0, counts: {} };
    if (box.children.length !== rows.length)
      box.innerHTML = rows.map((r) => `<div class="v-bar" role="listitem"><span>${esc(r.label)}</span><div class="v-track" aria-hidden="true"><div class="v-fill"></div></div><span class="v-pct">0%</span></div>`).join("");
    requestAnimationFrame(() =>
      rows.forEach((r, k) => {
        const p = t.n ? Math.round(((t.counts[r.id] || 0) / t.n) * 100) : 0;
        const row = box.children[k];
        if (!row) return;
        row.querySelector(".v-fill").style.width = `${p}%`;
        row.querySelector(".v-pct").textContent = `${p}%`;
      })
    );
  }
  // The voting countdown: a thin bar that empties (the projector is the clock)
  const bar = app.querySelector(".v-cd i");
  if (!bar || !state) return;
  const v = state.vote;
  bar.parentElement.classList.toggle("hidden", !v || v.locked);
  if (!v) return;
  const sig = `${v.paused}|${v.locked}|${Math.round(v.remainingMs / 1500)}|${v.duration}`;
  if (sig === lastVoteSig) return;
  lastVoteSig = sig;
  const frac = v.duration ? Math.min(1, v.remainingMs / (v.duration * 1000)) : 0;
  bar.style.transition = "none";
  bar.style.transform = `scaleX(${frac})`;
  bar.parentElement.classList.toggle("paused", !!v.paused);
  if (v.running && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    void bar.offsetWidth;
    bar.style.transition = `transform ${v.remainingMs}ms linear`;
    bar.style.transform = "scaleX(0)";
  }
}

/** Options as sign-style buttons. `sel` is the picked id (teal with a check); `locked` after voting. */
function optButtons(list, { sel, locked = false } = {}) {
  return `<div class="v-opts" role="group" aria-labelledby="qh">${list
    .map((o, k) => {
      const on = sel === o.id;
      return `<button type="button" class="v-opt${on ? " mine" : ""}" data-a="${esc(o.id)}" aria-pressed="${on}" ${locked || sending ? "disabled" : ""}><span class="l" aria-hidden="true">${on ? CHECK : esc(LETTERS[k])}</span><span class="t">${esc(o.text)}</span><span class="ar" aria-hidden="true">${ARROW}</span></button>`;
    })
    .join("")}</div>`;
}

function votingUI(s, lock) {
  const locked = lock !== undefined;
  const d = (draft[s.id] = draft[s.id] || { picks: [], text: "", parts: {} });
  const dis = locked || sending ? "disabled" : "";
  const sendBtn = (label, disabled) => (locked ? "" : `<div class="v-actions"><button type="button" class="v-go" data-act="send" ${disabled || sending ? "disabled" : ""}>${esc(sending ? U("sending") : label)}</button></div>`);
  const help = (txt, id = "") => (locked ? "" : `<p class="v-help"${id ? ` id="${id}"` : ""}>${esc(txt)}</p>`);
  switch (s.format) {
    case "choose":
      return `${help(U("tapAnswer"))}${optButtons(s.options, { sel: locked ? lock : sending ? pendingAnswer : undefined, locked })}`;
    case "pickn": {
      const picks = locked ? (Array.isArray(lock) ? lock : []) : d.picks;
      return `${help(U("pickHelp", { n: s.n }), "pkh")}
        <div class="v-opts v-chips" role="group" aria-labelledby="${locked ? "qh" : "pkh"}">${s.items
          .map((o, k) => {
            const on = picks.includes(o.id);
            return `<button type="button" class="v-opt${on ? " mine" : ""}" role="checkbox" aria-checked="${on}" data-pick="${esc(o.id)}" ${dis}><span class="l" aria-hidden="true">${on ? CHECK : k + 1}</span><span class="t">${esc(o.text)}</span></button>`;
          })
          .join("")}</div>
        ${locked ? "" : `<p class="v-count" aria-live="polite">${esc(U("picked", { k: d.picks.length, n: s.n }))}</p>`}${sendBtn(U("sendPicks"), d.picks.length !== s.n)}`;
    }
    case "wordcloud": {
      const max = s.maxLength || 40;
      return `<div class="v-word"><label for="word">${esc(U("wordHelp"))}</label><input id="word" maxlength="${max}" autocomplete="off" enterkeyhint="send" value="${esc(d.text)}" aria-describedby="wc"/>
        <p class="v-count" id="wc" aria-live="polite">${esc(U("charsLeft", { n: max - [...d.text].length }))}</p></div>
        ${sendBtn(memory().w ? U("wordAnother") : U("send"), !d.text.trim())}`;
    }
    case "dualcloud": {
      const max = s.maxLength || 40;
      const any = s.parts.some((pt) => (d.parts[pt.id] || "").trim());
      return `<p class="v-help">${esc(U("dualHelp"))}</p>${s.parts
        .map((pt) => {
          const v = d.parts[pt.id] || "";
          return `<div class="v-part ${esc(pt.color)}"><label for="w-${pt.id}">${esc(pt.title)}</label>
            <input id="w-${pt.id}" data-part="${esc(pt.id)}" maxlength="${max}" autocomplete="off" value="${esc(v)}" aria-describedby="wc-${pt.id}"/>
            <p class="v-count" id="wc-${pt.id}" aria-live="polite">${esc(U("charsLeft", { n: max - [...v].length }))}</p></div>`;
        })
        .join("")}${sendBtn(U("sendWords"), !any)}`;
    }
  }
  return "";
}

function wire(s) {
  const d = draft[s.id];
  if (!d || state.phase !== "open") return;
  app.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => send(b.dataset.a)));
  app.querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.pick;
      if (d.picks.includes(id)) d.picks = d.picks.filter((x) => x !== id);
      else if (d.picks.length < s.n) d.picks.push(id);
      else return announce(U("pickHelp", { n: s.n }));
      render(true);
      app.querySelector(`[data-pick="${id}"]`)?.focus();
    })
  );
  app.querySelectorAll("[data-part]").forEach((inp) =>
    inp.addEventListener("input", () => {
      d.parts[inp.dataset.part] = inp.value;
      $(`#wc-${inp.dataset.part}`).textContent = U("charsLeft", { n: (s.maxLength || 40) - [...inp.value].length });
      app.querySelector('[data-act="send"]').disabled = !Object.values(d.parts).some((v) => v.trim());
    })
  );
  const word = $("#word");
  if (word) {
    word.addEventListener("input", () => {
      d.text = word.value;
      $("#wc").textContent = U("charsLeft", { n: (s.maxLength || 40) - [...word.value].length });
      app.querySelector('[data-act="send"]').disabled = !word.value.trim();
    });
    word.addEventListener("keydown", (e) => e.key === "Enter" && word.value.trim() && sendWord(word.value));
  }
  app.querySelector('[data-act="send"]')?.addEventListener("click", () => {
    if (s.format === "pickn") return send([...d.picks]);
    if (s.format === "wordcloud") return sendWord(d.text);
    if (s.format === "dualcloud") return sendDual(d.parts);
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
function failed(status, data) {
  if (status === 409 || data.reason === "closed") return U("missedVote");
  if (data.reason === "rephrase") return U("wordRejected");
  if (data.reason === "limit") return U("wordLimit");
  return U("sendFailed");
}
async function send(answer) {
  if (!state || state.phase !== "open" || sending || memory().v !== undefined) return;
  const slot = state.slot;
  sending = true;
  notice = "";
  pendingAnswer = answer;
  render(true);
  const { status, data } = await post("/api/vote", { voter: VOTER, slot, answer });
  sending = false;
  pendingAnswer = null;
  if (state.slot !== slot) return render(true); // the step moved on while sending
  if (status === 200 && data.ok) {
    remember({ v: data.answer ?? answer });
    announce(U("youreIn"));
    if (navigator.vibrate) navigator.vibrate(40);
  } else notice = failed(status, data);
  if (data.state && data.state.slot === state.slot) state = { ...state, ...data.state };
  render(true);
}
async function sendWord(text) {
  const slot = state.slot;
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (!clean || sending) return;
  if (isProfane(clean)) return (notice = U("wordRejected")), render(true);
  sending = true;
  notice = "";
  render(true);
  const { status, data } = await post("/api/word", { voter: VOTER, slot, text: clean });
  sending = false;
  if (state.slot !== slot) return render(true);
  if (status === 200 && data.ok) {
    remember({ w: data.count });
    draft[slot].text = "";
    announce(U("wordSent"));
  } else if (data.reason === "limit") remember({ w: 3 });
  else notice = failed(status, data);
  render(true);
  $("#word")?.focus();
}
/** Two clouds: both parts in one request; a blank part is left out. */
async function sendDual(parts) {
  const slot = state.slot;
  const entries = Object.entries(parts)
    .map(([part, t]) => ({ part, text: String(t || "").replace(/\s+/g, " ").trim() }))
    .filter((e) => e.text);
  if (!entries.length || sending) return;
  if (entries.some((e) => isProfane(e.text))) return (notice = U("wordRejected")), render(true);
  sending = true;
  notice = "";
  render(true);
  const { status, data } = await post("/api/word", { voter: VOTER, slot, entries });
  sending = false;
  if (state.slot !== slot) return render(true);
  if ((status === 200 && data.ok) || data.reason === "limit") {
    remember({ w: data.count || entries.length });
    draft[slot].parts = {};
    announce(U("dualSent"));
  } else notice = failed(status, data);
  render(true);
}

function applyState(st) {
  if (!st || st.hostOnly) return;
  state = st;
  if (st.slot !== lastSlot || st.phase === "idle") {
    // A new step: forget drafts, half-sent answers and messages from the previous one, so a phone never
    // shows a cached earlier question.
    if (st.slot !== lastSlot) {
      for (const k of Object.keys(draft)) if (k !== st.slot) delete draft[k];
      sending = false;
      pendingAnswer = null;
      notice = "";
      renderedKey = "";
    }
    lastSlot = st.slot;
  }
  render();
}
async function poll() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    applyState(await r.json());
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
    backoff = Math.min(backoff * 1.6, 6000);
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

(async function init() {
  try {
    C = await (await fetch("/content/en.json", { cache: "no-store" })).json();
  } catch {
    app.innerHTML = `<div class="v-wait">${MILESTONE}<p class="v-big">We can't reach the ride</p><p class="v-sub">Check your Wi-Fi or mobile data, then reload this page.</p></div>`;
    return;
  }
  STEPS = flatten(C);
  $(".skip").textContent = U("skip");
  $("#foot").textContent = U("anonymous");
  setConn(false, "connecting");
  render();
  await poll();
  connect();
})();

window.__vote = { get state() { return state; }, dropConnection: () => ws?.close() }; // dropConnection: for the reconnect test
