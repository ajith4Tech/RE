// The Ride: shared components, drawn to the Stitch designs and driven by content/en.json.
// Every function returns HTML; persona colours come from base.css through data-p="<persona id>".
import { icon } from "./icons.js";
import { esc, fmt, LETTERS } from "./route.js";

/** Persona badge objects (en.json) → Material Symbols. */
const BADGE = { compass: "explore", binoculars: "visibility", hands: "diversity_3", padlock: "lock", wrench: "build" };
export const personaIcon = (C, pid) => BADGE[C.personas[pid]?.badge] || "explore";

/** A persona pill: their colour, their object, a label (their name by default). */
export function pill(C, pid, label, cls = "label-lg") {
  return `<span class="pill persona" data-p="${esc(pid)}">${icon(personaIcon(C, pid))}<span class="${cls}">${esc(label ?? C.personas[pid].name)}</span></span>`;
}

/** The persona that colours a stop: its own, or the crew's (the pump and the palace have none). */
export const stopPersona = (stop) => stop?.persona || "crew";

/** "Question 2 of 7" for the room's questions (not the guess or the pump). */
export function questionOf(C, stepId) {
  const qs = C.stops.flatMap((s) => s.steps).filter((x) => x.type === "question");
  const k = qs.findIndex((x) => x.id === stepId);
  return k < 0 ? "" : fmt(C.ui.questionOf, { n: k + 1, total: qs.length });
}

/** The motorcycle and rider from the Stitch road stage (220×130, facing right, no face).
 *  Wheels carry two spokes so the spin reads while riding. */
export function bike(pid, { beam = false } = {}) {
  const wheel = (cx) => `<g class="wheel" style="transform-origin:${cx}px 96px"><circle cx="${cx}" cy="96" r="24" fill="#161310" stroke="#889391" stroke-width="5"/><circle cx="${cx}" cy="96" r="10" fill="none" stroke="#BDC9C6" stroke-width="2"/><path d="M${cx} 74V118M${cx - 22} 96H${cx + 22}" stroke="#3E4947" stroke-width="2"/></g>`;
  return `<svg class="bike" data-p="${esc(pid)}" viewBox="0 0 220 130" aria-hidden="true" focusable="false">
    ${wheel(52)}${wheel(168)}
    <g class="body">
      <path d="M24 94h48l22-18h40l26 18" fill="none" stroke="#BDC9C6" stroke-width="4" stroke-linecap="round"/>
      <rect x="86" y="70" width="32" height="24" rx="5" fill="#383431" stroke="#889391" stroke-width="2"/>
      <path d="M90 62c12-10 34-10 44 0l-6 12H88z" class="tank"/>
      <path d="M142 52l22 40" stroke="#BDC9C6" stroke-width="5" stroke-linecap="round"/>
      <circle cx="154" cy="54" r="6" fill="#FBBF24"/>
      ${beam ? `<polygon class="beam" points="160,50 218,34 218,74 160,58" fill="#FBBF24"/>` : ""}
      <path d="M84 62l16 14l-4 18" fill="none" stroke="#33302C" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M76 62c2-18 14-26 26-22l12 18l-18 8z" class="jacket"/>
      <path d="M98 44l28 8l14-2" fill="none" class="arm" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="96" cy="24" r="13" class="helmet" stroke-width="2"/>
      <path d="M98 20h11c0 6-4 9-11 9z" fill="#161310"/>
    </g></svg>`;
}

/** A roadside milestone: "870 KM / Adilabad" in the stop's colour. */
export function milestone(pid, top, bottom, ic) {
  return `<div class="milestone" data-p="${esc(pid)}">${ic ? icon(ic) : ""}<span class="mono-md caps">${esc(top)}</span><span class="label-sm">${esc(bottom)}</span></div>`;
}

/** The route (bottom HUD): passed stops ticked, the current one a pill in its persona's colour. */
export function route(C, cur, { lobby = false, personaAt = () => "crew", riding = false } = {}) {
  const sep = `<span class="sep mono-md" aria-hidden="true">${lobby ? "→" : "──"}</span>`;
  return C.places
    .map((p, k) => {
      const pid = personaAt(p);
      const last = k === C.places.length - 1;
      if (k === cur && !riding)
        return lobby
          ? `<span class="stopname now" data-p="${pid}"><i class="dot"></i><span class="label-lg">${esc(p.name)}</span></span>`
          : `<span class="stopname now" data-p="${pid}">${icon(last ? "flag" : personaIcon(C, pid))}<span class="label-lg">${esc(p.name)}</span></span>`;
      if (k < cur || (riding && k === cur)) return `<span class="stopname done">${icon("check_circle")}<span class="label-lg">${esc(p.name)}</span></span>`;
      return `<span class="stopname label-lg">${esc(p.name)}</span>`;
    })
    .join(sep);
}

/** A loose bolt: a hex nut. */
export function nut(cls = "") {
  return `<svg class="nut ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.6l9 5.2v10.4l-9 5.2-9-5.2V6.8z" fill="currentColor"/><circle cx="12" cy="12" r="4.2" class="hole"/></svg>`;
}

/** A small clock face showing `total` minutes after midnight (hands rotate from 12 o'clock; CSS can sweep them). */
export function clockFace(total, cls = "") {
  const ticks = Array.from({ length: 12 }, (_, k) => `<line x1="20" y1="${k % 3 ? 4.5 : 3.5}" x2="20" y2="${k % 3 ? 6.5 : 8}" transform="rotate(${k * 30} 20 20)"/>`).join("");
  return `<svg class="clockface ${cls}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="18" class="face"/><g class="ticks">${ticks}</g><line class="hh" x1="20" y1="20" x2="20" y2="11" style="transform:rotate(${total * 0.5}deg)"/><line class="mh" x1="20" y1="20" x2="20" y2="6" style="transform:rotate(${total * 6}deg)"/><circle cx="20" cy="20" r="2" class="pin"/></svg>`;
}

/** Effect chips: [{ cls: saved | added | rupees | bolt, text }]. */
export function chipsHTML(chips, cls = "") {
  if (!chips?.length) return "";
  return `<span class="chips ${cls}">${chips.map((c) => `<span class="fx ${esc(c.cls)}">${c.cls === "bolt" ? nut() : ""}${esc(c.text)}</span>`).join("")}</span>`;
}

/** The DETOUR road sign that swings in beside the road. */
export function detourSign(text) {
  return `<svg viewBox="0 0 132 150" aria-hidden="true" focusable="false"><rect x="62" y="56" width="8" height="94" rx="2" fill="#3a3632"/><rect x="58" y="142" width="16" height="8" rx="2" fill="#2a2622"/>
    <g><rect x="4" y="6" width="124" height="60" rx="8" fill="#f97316" stroke="#1e1b18" stroke-width="4"/><rect x="10" y="12" width="112" height="48" rx="5" fill="none" stroke="#1e1b18" stroke-width="2" opacity=".5"/>
    <text x="66" y="35" text-anchor="middle" font-family="Poppins, sans-serif" font-weight="700" font-size="20" letter-spacing="1.5" fill="#1e1b18">${esc(text)}</text>
    <path d="M34 49h58m0 0l-9-7m9 7l-9 7" stroke="#1e1b18" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

/** One answer with its live result (Stitch option card). badges: a traveller card for Q7. */
export function optionCard(C, step, o, k, lines = {}) {
  if (step.format === "badges") {
    const pid = o.persona;
    return `<div class="opt trav" data-o="${esc(o.id)}" data-p="${esc(pid)}"><div class="opt-top"><span class="who label-lg">${icon(personaIcon(C, pid))}${esc(C.personas[pid].name)}</span><span class="pct mono-md"></span></div><p class="t body-md">${esc(lines[pid] ? `“${lines[pid]}”` : o.text)}</p><span class="bar"><i></i></span></div>`;
  }
  const bar = step.format === "pickn" ? "" : `<span class="bar"><i></i></span>`;
  return `<div class="opt" data-o="${esc(o.id)}"><div class="opt-top"><span class="key mono-md">${step.format === "pickn" ? k + 1 : LETTERS[k]}</span><p class="t body-md">${esc(o.text)}</p><span class="pct mono-md"></span></div>${bar}</div>`;
}

/** A QR code as an SVG (vendor/qrcode.js, bundled). */
export function qr(url) {
  if (!url || typeof qrcode === "undefined") return "";
  try {
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    return "";
  }
}

/** mm:ss for the timers. */
export const clock = (ms) => {
  const s = Math.max(0, Math.ceil((ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** A neutral avatar: a circle in the traveller's colour with their object (no faces). */
export function avatar(C, pid, cls = "") {
  return `<span class="avatar ${cls}" data-p="${esc(pid)}" aria-hidden="true">${icon(personaIcon(C, pid))}</span>`;
}
