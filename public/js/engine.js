// The Ride: the choices-and-consequences engine. Pure functions over the content and the screen list, shared by
// the projector, the phones and the moderator view.
//
//   ARRIVAL CLOCK  starts at config trip.idealArrival (6:00 PM); every chosen option adds or subtracts minutes.
//   FUEL BILL      starts at trip.baseFuel (₹2,000); over-cautious options and broken bolts add rupees.
//   LOOSE BOLTS    an option can plant a bolt (C.bolts[id]); it breaks at the start of the stop named in its
//                  breaksAt, on that stop's DETOUR screen, adding its minutes and rupees.
//
// Nothing is stored: the trip at screen i is folded from the room's choice at every REVEAL up to i (and every
// DETOUR whose bolt is loose by then). So going back and forward always agrees with itself.
import { stepOf, fmt } from "./route.js";

export const TYPES = ["smart", "careful", "over-cautious", "shortcut"];
export const optionOf = (step, id) => step?.options?.find((o) => o.id === id) || null;
/** A question whose options move the clock. */
export const movesClock = (step) => step?.type === "question" && !!step.options?.some((o) => "minutes" in o || "type" in o);

export function idealMinutes(C) {
  const [h, m] = String(C.trip?.idealArrival || "18:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
export const baseFuel = (C) => Number(C.trip?.baseFuel ?? 2000);

/** The trip at screen i. choiceOf(stepId) → the room's option id (or null if not decided). */
export function tripAt(C, SCREENS, i, choiceOf) {
  const T = { minutes: 0, rupees: baseFuel(C), loose: [], planted: [], broken: [], choices: [], atStop: {} };
  for (const s of SCREENS) {
    if (s.i > i) break;
    if (s.beat === "detour") {
      const k = T.loose.indexOf(s.bolt);
      const b = C.bolts?.[s.bolt];
      if (k >= 0 && b) {
        T.loose.splice(k, 1);
        T.minutes += b.minutes || 0;
        T.rupees += b.rupees || 0;
        T.broken.push({ id: s.bolt, stop: s.stop, screen: s.i, minutes: b.minutes || 0, rupees: b.rupees || 0 });
      }
    } else if (s.beat === "reveal") {
      const step = stepOf(C, s);
      if (movesClock(step)) {
        const o = optionOf(step, choiceOf(step.id));
        if (o) {
          T.minutes += o.minutes || 0;
          T.rupees += o.rupees || 0;
          if (o.bolt && C.bolts?.[o.bolt] && !T.loose.includes(o.bolt) && !T.broken.some((b) => b.id === o.bolt)) {
            T.loose.push(o.bolt);
            T.planted.push({ id: o.bolt, stop: s.stop, screen: s.i });
          }
          T.choices.push({ step: step.id, stop: s.stop, option: o.id, screen: s.i });
        }
      }
    }
    if (s.stop >= 0) T.atStop[s.stop] = T.minutes;
  }
  return T;
}

/** Is this DETOUR screen due (its bolt loose when the convoy gets there)? */
export function detourDue(C, SCREENS, t, choiceOf) {
  const s = SCREENS[t];
  return s?.beat === "detour" && tripAt(C, SCREENS, t - 1, choiceOf).loose.includes(s.bolt);
}

// ------------------------------------------------------------------ the three routes, worked out from the content
/** What an option really costs by the end: its own minutes and rupees, plus its bolt's when that breaks. */
function trueCost(C, o) {
  const b = o.bolt ? C.bolts?.[o.bolt] : null;
  return { minutes: (o.minutes || 0) + (b?.minutes || 0), rupees: (o.rupees || 0) + (b?.rupees || 0), bolt: b ? 1 : 0 };
}
/** The option a route takes at one question. */
function routePick(C, step, route) {
  const first = (...types) => {
    for (const t of types) {
      const o = step.options.find((x) => x.type === t);
      if (o) return o;
    }
    return step.options[0];
  };
  if (route === "shortcut") return first("shortcut", "smart", "careful");
  if (route === "over-cautious") return first("over-cautious", "careful", "smart");
  // optimal: the fewest minutes by the end, then the fewest rupees, then no bolt
  return [...step.options].sort((a, b) => {
    const x = trueCost(C, a), y = trueCost(C, b);
    return x.minutes - y.minutes || x.rupees - y.rupees || x.bolt - y.bolt;
  })[0];
}
export function routePicks(C, route) {
  const picks = {};
  for (const st of C.stops) for (const step of st.steps) if (movesClock(step)) picks[step.id] = routePick(C, step, route).id;
  return picks;
}
/** Each route's full trip, with what its shortcuts saved and what its bolts cost later. */
export function routes(C, SCREENS) {
  return (C.routes?.list || []).map((r) => {
    const picks = routePicks(C, r.id);
    const trip = tripAt(C, SCREENS, SCREENS.length - 1, (id) => picks[id]);
    return { ...r, picks, trip, ...savedAndCost(C, trip) };
  });
}
/** Minutes the trip's shortcuts saved when taken, and minutes its bolts cost when they broke. */
export function savedAndCost(C, trip) {
  let saved = 0;
  for (const ch of trip.choices) {
    const o = optionOf(C.stops[ch.stop].steps.find((x) => x.id === ch.step), ch.option);
    if (o?.type === "shortcut" && o.minutes < 0) saved -= o.minutes;
  }
  return { saved, cost: trip.broken.reduce((a, b) => a + b.minutes, 0) };
}

// ------------------------------------------------------------------ wording
const MINUS = "−";
/** "6:15 PM" for minutes after (or before) the ideal arrival. */
export function clockText(C, delta) {
  const t = (((idealMinutes(C) + delta) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
/** "1 hr 30 min", "45 min", "2 hr" (no sign). */
export function durText(C, min) {
  const a = Math.abs(Math.round(min)), h = Math.floor(a / 60), m = a % 60;
  const u = C.ui.minutes;
  return h && m ? fmt(u.hm, { h, m }) : h ? fmt(u.h, { h }) : fmt(u.m, { m });
}
/** "+1 hr 30 min", "−30 min". */
export const deltaText = (C, min) => `${min < 0 ? MINUS : "+"}${durText(C, min)}`;
/** "4 hours 45 minutes", "2 hours", "30 minutes". */
export function longText(C, min) {
  const a = Math.abs(Math.round(min)), h = Math.floor(a / 60), m = a % 60;
  const L = C.ui.long;
  const hs = h === 1 ? L.hour : fmt(L.hours, { n: h });
  const ms = m === 1 ? L.minute : fmt(L.minutes, { n: m });
  return h && m ? `${hs} ${ms}` : h ? hs : ms;
}
export const rupeeText = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
/** Late, early or on time against the ideal arrival. */
export function vsIdeal(C, delta) {
  if (!delta) return C.ui.onTime;
  return fmt(delta > 0 ? C.ui.late : C.ui.early, { d: durText(C, delta) });
}

/** An option's (or a bolt's) effect as chips: { cls: saved | added | rupees | bolt, text }. */
export function effectChips(C, o) {
  const out = [];
  if (o.minutes) out.push({ cls: o.minutes < 0 ? "saved" : "added", text: deltaText(C, o.minutes) });
  if (o.rupees) out.push({ cls: "rupees", text: `+${rupeeText(o.rupees)}` });
  if (o.bolt) out.push({ cls: "bolt", text: C.ui.boltPlanted });
  return out;
}
/** The same, as one phrase for the phones: "−30 min, bolt planted". */
export function effectPhrase(C, o) {
  const chips = effectChips(C, o).map((c, k) => (c.cls === "bolt" && k ? c.text.toLowerCase() : c.text));
  return chips.join(", ") || C.ui.onTime;
}
export const typeLabel = (C, t) => C.ui.types?.[t] || t || "";
