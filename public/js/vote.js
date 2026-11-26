/* The Ride: phones.
 * Always shows the current step and beat (from the server's slot + phase). One answer per phone per step
 * (a random id in localStorage); every vote carries the step id, and nothing from an earlier step survives.
 * Real buttons, a polite live region, large tap targets, 18px+ inputs (no zoom), safe-area padding.
 */
import { buildScreens, phaseOf, stepOf, stopOf, placeOf, isVoteStep, filled, fmt, esc } from "./route.js";
import { icon } from "./icons.js";
import { pill, personaIcon, stopPersona, questionOf, clock } from "./ui.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let C = null;
let SCREENS = [];
let state = null;
let lastSlot = null;
let renderedKey = "";
let sending = false;
let notice = "";
let picks = [];
let ws = null;
let wsOpen = false;
let backoff = 1500;
let lastKm = 0;
let voteEnd = 0;
const conn = { ok: false, key: "connecting" };
const P = (k, v) => fmt(C.ui.phone[k], v);

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
  return { round: state?.round, slot: state?.slot, v: undefined };
}
const remember = (patch) => store.set("ride.votes", JSON.stringify({ ...memory(), ...patch }));
const announce = (msg) => {
  const a = $("#announce");
  a.textContent = "";
  setTimeout(() => (a.textContent = msg), 50);
};
function setConn(ok, key) {
  conn.ok = ok;
  conn.key = key;
  if (C) side();
}

/** The screen the projector is on: the first screen with this slot whose beat maps to this phase. */
function currentScreen() {
  if (!state) return null;
  return SCREENS.find((s) => s.slot === state.slot && (phaseOf(s, false) === state.phase || phaseOf(s, true) === state.phase)) || null;
}

/** A waiting cue in the Stitch status card: a round badge with an icon, a line, an optional sub-line. */
const card = (ic, big, sub = "", cls = "") =>
  `<div class="v-card ${cls}"><span class="badge">${icon(ic)}</span><div class="txt"><h2 class="headline-lg-m balance">${esc(big)}</h2>${sub ? `<p class="body-md muted">${esc(sub)}</p>` : ""}</div>${cls.includes("waiting") ? `<span class="wait"><i></i></span>` : ""}</div>`;
const qHead = (step) => `<div class="q-head">${step.type === "question" ? `<span class="mono-md caps">${esc(questionOf(C, step.id))}</span>` : ""}<h1 class="headline-lg-m balance" id="qh">${esc(step.question)}</h1></div>`;

/** The header (place and persona), the clock or connection state, and the km in the footer. */
function chrome(s, stop) {
  const pid = stopPersona(stop);
  $("#shell").dataset.p = pid;
  const place = placeOf(C, stop);
  const label = stop ? (stop.persona && !["arrive", "ride"].includes(s?.beat) ? `${C.personas[stop.persona].name} · ${place?.name || stop.spot}` : place?.name || stop.spot) : C.title;
  $("#where").innerHTML = pill(C, pid, label, "label-sm");
  if (place) lastKm = place.km;
  $("#km").textContent = P("progress", { km: lastKm.toLocaleString("en-IN"), total: C.places[C.places.length - 1].km.toLocaleString("en-IN") });
  side();
}
/** Right of the header: the vote clock while voting is open; otherwise the connection state. */
function side() {
  const el = $("#side");
  const v = state?.vote;
  if (!conn.ok) {
    el.className = "v-side bad";
    el.innerHTML = `${icon("wifi_off")}<span class="label-sm">${esc(P(conn.key))}</span>`;
    return;
  }
  el.className = "v-side";
  if (state?.phase === "open" && v && !v.locked) {
    const left = v.running ? Math.max(0, voteEnd - Date.now()) : v.remainingMs;
    el.innerHTML = `<span class="mono-md${left < 6000 ? " low" : ""}">${clock(left)}</span>`;
    return;
  }
  el.innerHTML = `<i class="dot" aria-hidden="true"></i><span class="label-sm">${esc(P("connected"))}</span>`;
}

function render(force) {
  if (!C) return;
  const s = currentScreen();
  const ph = state?.phase;
  if (!state) {
    chrome(null, null);
    app.innerHTML = card("explore", P("connecting"), "", "quiet waiting");
    return;
  }
  const mem = memory();
  const key = JSON.stringify([state.slot, ph, state.round, mem.v, sending, notice, picks]);
  if (key === renderedKey && !force) return side();
  renderedKey = key;

  const stop = stopOf(C, s);
  const step = stepOf(C, s);
  const persona = stop?.persona ? C.personas[stop.persona] : null;
  chrome(s, stop);

  if (!s) return (app.innerHTML = card("visibility", P("lookUp")));
  switch (s.beat) {
    case "lobby": return (app.innerHTML = card("check", C.lobby.phone, P("anonymous")));
    case "cold": case "title": case "crew": case "fact": case "crewClose": case "arrive": case "gather": case "handover":
      if (s.beat === "handover" && persona && stop.persona !== "crew") return (app.innerHTML = card(personaIcon(C, stop.persona), P("joins", { name: persona.name }), P("lookUp")));
      return (app.innerHTML = card("visibility", P("lookUp")));
    case "ignite": case "fired": return (app.innerHTML = card("bolt", C.ignition.phone));
    case "ride": {
      const dest = placeOf(C, stop)?.name;
      return (app.innerHTML = card(stop.type === "pump" ? "local_gas_station" : "route", dest ? P("riding", { place: dest }) : `${C.ui.onTheRoad}.`, "", "waiting"));
    }
    case "listen": return (app.innerHTML = card("record_voice_over", P("listenTo", { name: stop.persona === "crew" ? persona.short : persona.name })));
    case "look": return (app.innerHTML = card("visibility", P("lookAtScreen")));
    case "card":
      return (app.innerHTML = `${card("visibility", P("lookUp"))}${filled(step.link) ? `<a class="v-link label-lg" href="${esc(step.link)}" target="_blank" rel="noopener">${icon("open_in_new")}${esc(P("openLink"))}</a>` : ""}`);
    case "closing": return (app.innerHTML = card("flag", step.text));
    case "think": return (app.innerHTML = `${qHead(step)}${card("hourglass_top", P("think"), "", "quiet waiting")}`);
    case "reveal": return (app.innerHTML = `${qHead(step)}${card("visibility", P("reveal"))}`);
  }
  if (isVoteStep(step)) return voteScreen(step, ph, mem);
  app.innerHTML = card("visibility", P("lookUp"));
}

function voteScreen(step, ph, mem) {
  const open = ph === "open";
  const voted = mem.v !== undefined;
  const mine = (id) => (Array.isArray(mem.v) ? mem.v.includes(id) : mem.v === id);
  let body = "";
  if (open && !voted) {
    if (step.format === "pickn") {
      body = `<p class="body-md muted" id="pkh">${esc(P("pickHelp", { n: step.n }))}</p>
        <div class="v-opts compact" role="group" aria-labelledby="pkh">${step.options.map((o) => {
          const on = picks.includes(o.id);
          return `<button type="button" class="v-opt" role="checkbox" aria-checked="${on}" data-pick="${esc(o.id)}" ${sending ? "disabled" : ""}><span class="title-md">${esc(o.text)}</span>${icon(on ? "check_circle" : "add")}</button>`;
        }).join("")}</div>
        <p class="v-count mono-md muted" aria-live="polite">${esc(P("picked", { k: picks.length, n: step.n }))}</p>
        <button type="button" class="v-go label-lg" data-send ${picks.length !== step.n || sending ? "disabled" : ""}>${icon("check")}${esc(sending ? P("sending") : P("sendPicks"))}</button>`;
    } else {
      body = `<div class="v-opts" role="group" aria-labelledby="qh">${step.options.map((o) => `<button type="button" class="v-opt" data-a="${esc(o.id)}" ${o.persona ? `data-p="${esc(o.persona)}"` : ""} ${sending ? "disabled" : ""}><span class="lead">${o.persona ? icon(personaIcon(C, o.persona)) : ""}<span class="title-md">${esc(o.text)}</span></span>${icon("chevron_right")}</button>`).join("")}</div>`;
    }
  } else {
    const picked = step.options.filter((o) => mine(o.id)).map((o) => o.text).join(" · ");
    if (voted) body = card(open ? "check" : "lock", open ? P("youreIn") : P("locked"), P("yourPick", { answer: picked }));
    else body = card(ph === "closed" ? "lock" : "visibility", ph === "closed" ? P("locked") : P("lookUp"), "", "quiet");
  }
  if (notice) body += `<p class="v-alert body-md" role="alert">${esc(notice)}</p>`;
  app.innerHTML = `${qHead(step)}${body}`;
  wire(step);
}

function wire(step) {
  if (state.phase !== "open") return;
  app.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => send(b.dataset.a)));
  app.querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.pick;
      if (picks.includes(id)) picks = picks.filter((x) => x !== id);
      else if (picks.length < step.n) picks = [...picks, id];
      else return announce(P("pickHelp", { n: step.n }));
      render(true);
      app.querySelector(`[data-pick="${id}"]`)?.focus();
    })
  );
  app.querySelector("[data-send]")?.addEventListener("click", () => send([...picks]));
}

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
  if (!state || state.phase !== "open" || sending || memory().v !== undefined) return;
  const slot = state.slot;
  sending = true;
  notice = "";
  render(true);
  const { status, data } = await post("/api/vote", { voter: VOTER, slot, answer });
  sending = false;
  if (state.slot !== slot) return render(true);
  if (status === 200 && data.ok) {
    remember({ v: data.answer ?? answer });
    announce(P("youreIn"));
    if (navigator.vibrate) navigator.vibrate(40);
  } else notice = status === 409 || data.reason === "closed" ? P("missedVote") : P("sendFailed");
  render(true);
}

function applyState(st) {
  if (!st || st.hostOnly) return;
  state = st;
  if (st.vote) voteEnd = Date.now() + (st.vote.remainingMs || 0);
  if (st.slot !== lastSlot) {
    sending = false;
    notice = "";
    picks = [];
    renderedKey = "";
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
    setTimeout(connect, backoff + Math.random() * 1000); // jitter so a full room doesn't reconnect in lock-step
    backoff = Math.min(backoff * 1.6, 6000);
  };
}
setInterval(() => ws && ws.readyState === 1 && ws.send("ping"), 25000);
setInterval(() => C && side(), 250);
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
    app.innerHTML = `<div class="v-card warn"><div class="txt"><h2 class="headline-lg-m">We can't reach the ride</h2><p class="body-md">Check your Wi-Fi or mobile data, then reload this page.</p></div></div>`;
    return;
  }
  SCREENS = buildScreens(C);
  $("#brand").textContent = P("brand");
  setConn(false, "connecting");
  render();
  await poll();
  connect();
})();
