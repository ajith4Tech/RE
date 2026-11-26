// The Ride: the route as one ordered list of screens, shared by the projector, phones and moderator view.
// Each screen is one beat of the story (ARRIVE → LISTEN → THINK → VOTE → LOCK → REVEAL → HANDOVER → RIDE).
// The moderator's main button always moves to the next screen, so every step is reached in order.
//
// A screen: { i, key, slot, beat, stop, step, enter, transient }
//   slot   the id the server and phones know (votes are scoped to it); several beats can share one slot
//   beat   lobby | cold | title | crew | fact | crewClose | ignite | fired | ride | arrive | listen | gather |
//          look | think | vote | locked | reveal | card | handover | closing
//   enter  the moderator's button label that moves INTO this screen ("Open voting", "Ride to Nagpur")
//   transient  plays by itself and moves on (the rides and the ignition)

/** A value still waiting for real content: empty, or text starting with "PLACEHOLDER". */
export const isPlaceholder = (v) => v == null || (typeof v === "string" && (!v.trim() || /^\s*PLACEHOLDER\b/i.test(v)));
export const filled = (v) => !isPlaceholder(v);

export function fmt(str, vars = {}) {
  return String(str ?? "").replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ""));
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const LETTERS = "ABCDEFGHI";
export const km = (n) => `${Number(n).toLocaleString("en-IN")} km`;

/** Steps people vote on. */
export const isVoteStep = (st) => !!st && ["guess", "question", "pump"].includes(st.type);
export const placeOf = (C, stop) => C.places.find((p) => p.id === stop?.place) || null;
export const placeIndex = (C, stop) => C.places.findIndex((p) => p.id === stop?.place);
/** The server phase for a screen (the Worker accepts these; phones read them). */
export function phaseOf(scr, closed) {
  if (scr.beat === "lobby") return "idle";
  if (scr.beat === "vote") return closed ? "closed" : "open";
  if (scr.beat === "locked") return "closed";
  return scr.beat;
}

export function buildScreens(C) {
  const out = [];
  const add = (o) => out.push({ stop: -1, step: null, ...o, i: out.length });
  add({ key: "lobby", slot: "lobby", beat: "lobby" });
  C.coldOpen.lines.forEach((_, k) => add({ key: `cold${k + 1}`, slot: `cold${k + 1}`, beat: "cold", line: k, enter: k ? "Next line" : C.lobby.button }));
  add({ key: "title", slot: "title", beat: "title", enter: "Show the title" });
  add({ key: "crew", slot: "crew", beat: "crew", enter: "Who's riding" });
  C.crew.facts.forEach((f, k) => filled(f) && add({ key: `fact${k + 1}`, slot: `fact${k + 1}`, beat: "fact", fact: k, enter: "Next fact" }));
  add({ key: "crewClose", slot: "crewClose", beat: "crewClose", enter: "Closing line" });
  add({ key: "ignite", slot: "ignite", beat: "ignite", enter: "Start the engine" });
  add({ key: "fired", slot: "fired", beat: "fired", enter: "Fire it up", transient: true });

  C.stops.forEach((st, si) => {
    const persona = st.persona ? C.personas[st.persona] : null;
    const place = placeOf(C, st);
    if (si > 0 && !st.sameCity)
      add({ key: `ride-${st.id}`, slot: `ride-${st.id}`, beat: "ride", stop: si, transient: true, enter: st.type === "pump" ? "Pull in to refuel" : `Ride to ${place?.name || st.spot}` });
    if (!st.sameCity) add({ key: `arrive-${st.id}`, slot: st.id, beat: "arrive", stop: si, enter: "Arrive" });
    if (persona) add({ key: `listen-${st.id}`, slot: st.id, beat: "listen", stop: si, crossfade: !!st.sameCity, enter: `Meet ${st.persona === "crew" ? persona.short : persona.name}` });
    if (st.gathering) add({ key: `gather-${st.id}`, slot: st.id, beat: "gather", stop: si, enter: "Gather the convoy" });
    for (const step of st.steps) {
      const base = { slot: step.id, stop: si, step: step.id };
      switch (step.type) {
        case "look":
          add({ ...base, key: step.id, beat: "look", enter: "Show the websites" });
          break;
        case "guess":
        case "pump":
          add({ ...base, key: `${step.id}-vote`, beat: "vote", enter: "Open voting" });
          add({ ...base, key: `${step.id}-locked`, beat: "locked", enter: "Lock votes" });
          break;
        case "question":
          add({ ...base, key: `${step.id}-think`, beat: "think", enter: "Show the question" });
          add({ ...base, key: `${step.id}-vote`, beat: "vote", enter: "Open voting" });
          add({ ...base, key: `${step.id}-locked`, beat: "locked", enter: "Lock votes" });
          add({ ...base, key: `${step.id}-reveal`, beat: "reveal", enter: "Reveal" });
          break;
        case "card":
          add({ ...base, key: step.id, beat: "card", enter: step.button || "Show the card" });
          break;
        case "closing":
          add({ ...base, key: step.id, beat: "closing", enter: "Close the ride" });
          break;
      }
    }
    if (st.handover && persona)
      add({ key: `handover-${st.id}`, slot: st.id, beat: "handover", stop: si, enter: st.persona === "crew" ? "Point the way" : `${persona.name} joins` });
  });
  return out;
}

/** The moderator's main button on screen i: names what happens next. */
export function nextLabel(SCREENS, i) {
  const nx = SCREENS[i + 1];
  return nx ? nx.enter : "The ride is over";
}

/** Who has joined the convoy by screen i (in order). The crew leads and is never a follower. */
export function convoyAt(C, SCREENS, i) {
  const out = [];
  for (const s of SCREENS) {
    if (s.i > i) break;
    if (s.beat === "handover") {
      const p = C.stops[s.stop].persona;
      if (p && p !== "crew" && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

/** The route line at screen i: index of the current dot (-1 before the ignition) and whether we're riding. */
export function routeAt(C, SCREENS, i) {
  const s = SCREENS[i];
  if (!s) return -1;
  if (s.i < SCREENS.findIndex((x) => x.beat === "fired")) return -1;
  let cur = 0;
  for (const x of SCREENS) {
    if (x.i > i) break;
    if (x.beat === "arrive" || x.beat === "listen") {
      const k = placeIndex(C, C.stops[x.stop]);
      if (k >= 0) cur = k;
    }
  }
  return cur;
}

export const stepOf = (C, scr) => (scr && scr.stop >= 0 && scr.step ? C.stops[scr.stop].steps.find((x) => x.id === scr.step) : null);
export const stopOf = (C, scr) => (scr && scr.stop >= 0 ? C.stops[scr.stop] : null);

/** Index of the first screen after the petrol pump (the ride to Nagpur), for "Skip the refuel stop". */
export function pumpSkip(C, SCREENS, i) {
  const pi = C.stops.findIndex((st) => st.skippable);
  if (pi < 0) return null;
  const firstPump = SCREENS.findIndex((x) => x.stop === pi);
  const after = SCREENS.findIndex((x) => x.stop > pi);
  if (firstPump < 0 || after < 0) return null;
  // Offer the skip from the screen just before the pump ride until the pump is done
  return i >= firstPump - 1 && i < after - 1 ? after : null;
}

/** Text still to be filled in, for the moderator view (by screen): [{ what, text }]. */
export function placeholdersOf(C, scr) {
  const out = [];
  const check = (what, v) => isPlaceholder(v) && out.push({ what, text: String(v ?? "(empty)") });
  if (!scr) return out;
  if (["crew", "fact", "crewClose"].includes(scr.beat)) C.crew.facts.forEach((f, k) => check(`Fact ${k + 1}`, f));
  const step = stepOf(C, scr);
  if (step?.sites || step?.revealSites) {
    const sites = step.sites || C.stops[scr.stop].steps.find((x) => x.sites)?.sites || [];
    for (const site of sites) {
      check(`${site.title}: built by`, site.builtBy);
      check(`${site.title}: time taken`, site.took);
      check(`${site.title}: cost`, site.cost);
    }
  }
  if (step && "link" in step) check("Insight Out link (its QR code appears once filled)", step.link);
  return out;
}
