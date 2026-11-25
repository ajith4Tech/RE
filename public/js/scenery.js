// The Ride — "The Highway" artwork. Flat, original SVG only: no maps, no logos, no brands.
//   Band:      a horizontal road strip along the bottom of the projector, with
//              regional landscape silhouettes (parallax), milestone stones, roadside signboards and the bike.
//   Emblems:   neutral persona badges (objects, never faces).
//   Icons:     the info board and the petrol pump.
// Calm palette: cream sky, soft stone silhouettes, a teal road; marigold only for small accents.
export const PAL = { teal: "#2F6F62", tint: "#DDEBE7", marigold: "#E8A33D", white: "#FFFFFF", ink: "#22252B", ink2: "#6B7078", line: "#E6E0D6", sky: "#F7F3EC" };
const SIL = "#E4DCCD"; // far silhouettes
const SIL2 = "#D8CEBC";
const TREE = "#B9CEC6"; // foliage: a soft tint of the teal
const TREE2 = "#A6C1B8";
const GROUND = "#EEE7DB";

const BAND_H = 300; // design height of the band; it is shown cropped from the bottom when collapsed
const HORIZON = 206;
const ROAD_Y = 236;
const ROAD_H = 44;
const SPACING = 1500; // world px between stops
const NUDGE = 30; // px the bike creeps forward per finished vote at a stop
const NUDGE_MAX = 6;
const X0 = 1000;
const BIKE_SCREEN_X = 640;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ------------------------------------------------------------------ landscapes (flat silhouettes)
const LAND = {
  deccan(x0, w) {
    let s = "";
    for (let x = x0; x < x0 + w; x += 150 + rnd() * 120) {
      const h = 40 + rnd() * 60;
      const c = rnd() > 0.5 ? SIL : SIL2;
      s += `<ellipse cx="${x}" cy="${HORIZON - h * 0.35}" rx="${46 + rnd() * 30}" ry="${h * 0.45}" fill="${c}"/>`;
      s += `<ellipse cx="${x + 34}" cy="${HORIZON - h * 0.8}" rx="${30 + rnd() * 16}" ry="${h * 0.32}" fill="${c}"/>`;
      if (rnd() > 0.5) s += `<ellipse cx="${x - 30}" cy="${HORIZON - h * 1.05}" rx="${20 + rnd() * 10}" ry="${h * 0.22}" fill="${SIL2}"/>`;
    }
    return s;
  },
  orange(x0, w) {
    let s = "";
    for (let row = 0; row < 2; row++)
      for (let x = x0 + row * 45; x < x0 + w; x += 90) {
        const y = HORIZON - 6 - row * 22;
        s += `<rect x="${x - 3}" y="${y - 18}" width="6" height="18" fill="${TREE2}"/><circle cx="${x}" cy="${y - 38}" r="${26}" fill="${row ? TREE : TREE2}"/>`;
        for (let k = 0; k < 4; k++) s += `<circle cx="${x - 14 + rnd() * 28}" cy="${y - 52 + rnd() * 26}" r="4" fill="${PAL.white}" opacity=".8"/>`;
      }
    return s;
  },
  bundelkhand(x0, w) {
    let s = "";
    for (let x = x0; x < x0 + w; x += 260 + rnd() * 160) {
      const h = 30 + rnd() * 40;
      s += `<path d="M${x} ${HORIZON} l40 -${h} h${120 + rnd() * 80} l40 ${h} z" fill="${SIL}"/>`;
      s += `<ellipse cx="${x + 230}" cy="${HORIZON - 6}" rx="16" ry="9" fill="${SIL2}"/>`;
      s += `<path d="M${x + 290} ${HORIZON} q6 -22 12 0 q6 -16 12 0" fill="${TREE2}"/>`;
    }
    const fx = x0 + w * 0.6;
    s += `<path d="M${fx} ${HORIZON} l20 -60 h160 l20 60 z" fill="${SIL2}"/>`;
    for (let k = 0; k < 8; k++) s += `<rect x="${fx + 26 + k * 20}" y="${HORIZON - 72}" width="10" height="12" fill="${SIL2}"/>`;
    return s;
  },
  palace(x0, w) {
    const px = x0 + w * 0.35;
    let s = `<rect x="${px - 260}" y="${HORIZON - 110}" width="520" height="110" fill="${SIL}"/>`;
    s += `<rect x="${px - 90}" y="${HORIZON - 150}" width="180" height="40" fill="${SIL}"/><path d="M${px - 60} ${HORIZON - 150} q60 -80 120 0 z" fill="${SIL2}"/>`;
    for (let k = 0; k < 11; k++) s += `<rect x="${px - 240 + k * 46}" y="${HORIZON - 92}" width="14" height="92" fill="${SIL2}"/>`;
    s += `<path d="M${px - 290} ${HORIZON - 110} h580 l-20 -14 h-540 z" fill="${SIL2}"/>`;
    for (let x = x0; x < x0 + w; x += 120) if (Math.abs(x - px) > 330) s += `<circle cx="${x}" cy="${HORIZON - 30}" r="24" fill="${TREE}"/>`;
    return s;
  },
};

// ------------------------------------------------------------------ milestones and roadside signboards in the band
// A milestone stone: white body, teal cap, the place name, and the km as small text. Names of stops not
// reached yet stay hidden; each appears on its milestone as the bike rides up to it.
function milestone(x, label, km, k) {
  const w = Math.max(44, Math.round(label.length * 5.4 + 14)); // half-width: fits the place name
  const r = 40;
  return `<g transform="translate(${x} ${ROAD_Y - 6})">
    <path d="M${-w} 0 V-78 Q${-w} ${-78 - r} 0 ${-78 - r} Q${w} ${-78 - r} ${w} -78 V0 Z" fill="${PAL.white}" stroke="${PAL.ink}" stroke-width="2"/>
    <path d="M${-w} -78 Q${-w} ${-78 - r} 0 ${-78 - r} Q${w} ${-78 - r} ${w} -78 Z" fill="${PAL.teal}"/>
    <g class="ms-label" data-k="${k}"><text x="0" y="-46" text-anchor="middle" class="ms-place">${label}</text>
    <text x="0" y="-20" text-anchor="middle" class="ms-km">${km}</text></g>
  </g>`;
}


// A roadside signboard: white board, teal border and text, two grey posts. Sized to its text.
const SIGN_CH = 12.4; // average width of one character at the sign's type size
function roadsign(cx, text) {
  const half = Math.round((text.length * SIGN_CH + 48) / 2);
  return `<g transform="translate(${cx} ${ROAD_Y - 6})">
    <rect x="${-half + 24}" y="-70" width="6" height="70" fill="${PAL.ink2}"/><rect x="${half - 30}" y="-70" width="6" height="70" fill="${PAL.ink2}"/>
    <rect x="${-half}" y="-128" width="${half * 2}" height="64" rx="8" fill="${PAL.white}" stroke="${PAL.teal}" stroke-width="3"/>
    <text x="0" y="-87" text-anchor="middle" class="rs-text">${esc(text)}</text></g>`;
}
const signHalf = (text) => Math.round((text.length * SIGN_CH + 48) / 2);

// ------------------------------------------------------------------ the motorcycle (original, flat, facing right; ground at y=0)
// The rider's helmet tops out at y = -190; the bike layer keeps all of it on screen.
export const BIKE_SVG = `
  <g class="bike-shadow"><ellipse cx="0" cy="2" rx="92" ry="7" fill="${PAL.ink}" opacity=".12"/></g>
  ${[-54, 56].map((wx) => `<g transform="translate(${wx} -30)"><g class="wheel">
    <circle r="29" fill="none" stroke="${PAL.ink}" stroke-width="10"/>
    <circle r="19" fill="none" stroke="${PAL.line}" stroke-width="3"/>
    <path d="M-19 0H19M0-19V19M-13-13L13 13M-13 13L13-13" stroke="${PAL.line}" stroke-width="2"/>
    <circle r="5" fill="${PAL.teal}"/></g></g>`).join("")}
  <g class="bike-body">
    <path d="M-92 -34 A38 38 0 0 1 -24 -54" fill="none" stroke="${PAL.teal}" stroke-width="8" stroke-linecap="round"/>
    <path d="M24 -54 A38 38 0 0 1 92 -36" fill="none" stroke="${PAL.teal}" stroke-width="8" stroke-linecap="round"/>
    <path d="M-54 -30 L-14 -50 L28 -44" fill="none" stroke="${PAL.ink}" stroke-width="7" stroke-linecap="round"/>
    <path d="M10 -36 Q-14 -22 -84 -30 l-14 -2" fill="none" stroke="#C9C3B8" stroke-width="9" stroke-linecap="round"/>
    <rect x="-20" y="-66" width="42" height="28" rx="4" fill="#6B7078" stroke="${PAL.ink}" stroke-width="2.5"/>
    <path d="M56 -30 L38 -96" stroke="#C9C3B8" stroke-width="8" stroke-linecap="round"/>
    <path d="M-10 -78 Q-2 -102 28 -100 Q50 -98 48 -80 Q40 -68 14 -68 Q-10 -68 -10 -78 Z" fill="${PAL.teal}" stroke="${PAL.ink}" stroke-width="2.5"/>
    <path d="M0 -86 Q18 -96 40 -88" fill="none" stroke="${PAL.white}" stroke-width="5" stroke-linecap="round"/>
    <rect x="-62" y="-90" width="54" height="14" rx="7" fill="${PAL.ink}"/>
    <circle cx="54" cy="-94" r="13" fill="${PAL.white}" stroke="${PAL.ink}" stroke-width="3.5"/>
    <path d="M38 -100 L28 -120 L12 -122" fill="none" stroke="${PAL.ink}" stroke-width="6" stroke-linecap="round"/>
    <path class="scarf" d="M-16 -150 Q-44 -158 -60 -148 Q-72 -138 -88 -146 Q-76 -130 -58 -136 Q-38 -140 -16 -140 Z" fill="${PAL.marigold}" stroke="${PAL.ink}" stroke-width="1.5"/>
    <path d="M-34 -94 L4 -90 L2 -56" fill="none" stroke="${PAL.ink}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2 -56 h14" stroke="${PAL.ink}" stroke-width="10" stroke-linecap="round"/>
    <path d="M-34 -94 L-16 -142" stroke="#3E8A7A" stroke-width="26" stroke-linecap="round"/>
    <path d="M-12 -134 L8 -116 L16 -120" fill="none" stroke="#3E8A7A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="-6" cy="-164" r="18" fill="#8A5634"/>
    <path d="M-28 -164 Q-28 -190 -4 -190 Q20 -188 18 -166 Z" fill="${PAL.white}" stroke="${PAL.ink}" stroke-width="2.5"/>
    <path d="M-27 -170 Q-4 -176 17 -170" fill="none" stroke="${PAL.teal}" stroke-width="4"/>
    <rect x="2" y="-172" width="18" height="10" rx="5" fill="${PAL.ink}"/>
  </g>`;

// ------------------------------------------------------------------ band
// The bike lives in its own SVG layer above the band (bikeSvg), never inside the band's
// clipped box, so the rider's head stays visible when the band collapses to its short height.
export function buildBand(svg, stops, bikeSvg) {
  seed = 11;
  const n = stops.length;
  const worldW = X0 * 2 + SPACING * (n - 1) + 1920;
  svg.setAttribute("viewBox", `0 0 1920 ${BAND_H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMax slice");
  const itemX = (k) => X0 + k * SPACING;

  // Far ridge (slow), landscapes (medium), ground/road/markers/bike (camera speed)
  let far = "";
  for (let x = -400; x < worldW * 0.3 + 2400; x += 220) far += `<path d="M${x} ${HORIZON} q110 -${40 + rnd() * 40} 220 0 z" fill="#EDE6DA"/>`;
  let land = "";
  stops.forEach((r, k) => {
    const cx = itemX(k) * 0.6;
    const span = SPACING * 0.6 + 200;
    land += `<g data-region="${r.landscape}">${(LAND[r.landscape] || LAND.deccan)(cx - span / 2, span)}</g>`;
  });
  // a lead-in before the first stop and after the last
  land = `<g>${(LAND[stops[0].landscape] || LAND.deccan)(-1200, itemX(0) * 0.6 + 400)}</g>` + land + `<g>${(LAND[stops[n - 1].landscape] || LAND.deccan)(itemX(n - 1) * 0.6 + 400, 2400)}</g>`;

  let ground = `<rect x="-2000" y="${HORIZON}" width="${worldW + 4000}" height="${BAND_H - HORIZON}" fill="${GROUND}"/>`;
  ground += `<rect x="-2000" y="${ROAD_Y}" width="${worldW + 4000}" height="${ROAD_H}" fill="${PAL.teal}"/>`;
  ground += `<line x1="-2000" x2="${worldW + 2000}" y1="${ROAD_Y + ROAD_H / 2}" y2="${ROAD_Y + ROAD_H / 2}" stroke="${PAL.white}" stroke-width="4" stroke-dasharray="40 34" opacity=".85"/>`;
  let marks = "";
  stops.forEach((st, k) => {
    marks += milestone(itemX(k), esc(st.place), `${st.km.toLocaleString("en-IN")} km`, k);
    // The signboards on the way into this stop: they show only during that ride, and pass by with the road.
    if (k > 0 && st.signs?.length) {
      const a = itemX(k - 1) + 560;
      const b = a + signHalf(st.signs[0]) + 120 + signHalf(st.signs[1] || "");
      marks += `<g class="roadsigns" data-seg="${k}">${roadsign(a, st.signs[0])}${st.signs[1] ? roadsign(b, st.signs[1]) : ""}</g>`;
    }
  });

  svg.innerHTML = `
    <rect width="1920" height="${BAND_H}" fill="${PAL.sky}"/>
    <g id="farLayer">${far}</g>
    <g id="landLayer">${land}</g>
    <g id="worldLayer">${ground}${marks}</g>`;
  bikeSvg.setAttribute("viewBox", `0 0 1920 ${BAND_H}`);
  bikeSvg.setAttribute("preserveAspectRatio", "xMidYMax meet");
  bikeSvg.innerHTML = `<g id="bikeLayer" transform="translate(${BIKE_SCREEN_X} ${ROAD_Y + 30})"><g id="bike">${BIKE_SVG}</g></g>`;

  const farL = svg.querySelector("#farLayer");
  const landL = svg.querySelector("#landLayer");
  const worldL = svg.querySelector("#worldLayer");
  const bike = bikeSvg.querySelector("#bike");
  let current = 0;
  let progress = 0;
  let pos = parkX(0);

  function place(worldBikeX) {
    pos = worldBikeX;
    const cam = worldBikeX - BIKE_SCREEN_X;
    worldL.setAttribute("transform", `translate(${-cam} 0)`);
    landL.setAttribute("transform", `translate(${-cam * 0.6} 0)`);
    farL.setAttribute("transform", `translate(${-cam * 0.3} 0)`);
  }
  // The bike parks well before the milestone; each revealed step at a stop moves it a little closer.
  function parkX(k) { return itemX(k) - 330; }
  const at = (k, p) => parkX(k) + Math.min(p, NUDGE_MAX) * NUDGE;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let raf = null;
  let delayT = null;

  // cls: "riding" between stops, "creeping" for the small move after a reveal (wheels turn for both)
  function animate(a, b, ms, onProgress, cls = "riding") {
    cancelAnimationFrame(raf);
    bike.classList.remove("riding", "creeping");
    bike.setAttribute("transform", b < a ? "scale(-1 1)" : "");
    if (reduce()) ms = Math.min(ms, 300);
    else bike.classList.add(cls);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = ease(t);
        place(a + (b - a) * e);
        onProgress?.(e);
        if (t < 1) raf = requestAnimationFrame(step);
        else {
          bike.classList.remove("riding", "creeping");
          bike.setAttribute("transform", "");
          resolve();
        }
      };
      raf = requestAnimationFrame(step);
    });
  }

  return {
    /** Park at stop k, p steps along. Moving forward within the same stop creeps there (after `delay` ms). */
    setStop(k, p = 0, delay = 0) {
      const target = at(k, p);
      const creep = k === current && p > progress && !reduce();
      const same = k === current && p === progress;
      current = k;
      progress = p;
      if (same) return;
      clearTimeout(delayT);
      if (creep) delayT = setTimeout(() => animate(pos, target, 900, null, "creeping"), delay);
      else {
        cancelAnimationFrame(raf);
        bike.classList.remove("riding", "creeping");
        bike.setAttribute("transform", "");
        place(target);
      }
    },
    ride(from, to, ms, onProgress) {
      clearTimeout(delayT);
      const a = pos;
      const b = parkX(to);
      const signs = to > from ? svg.querySelector(`.roadsigns[data-seg="${to}"]`) : null;
      signs?.classList.add("on");
      return animate(a, b, ms, onProgress).then(() => {
        signs?.classList.remove("on"); // they fade out as the bike arrives
        current = to;
        progress = 0;
      });
    },
    /** Show the place names of every stop up to k on their milestones; `pop` animates the newest one in. */
    setReached(k, pop = false) {
      svg.querySelectorAll(".ms-label").forEach((g) => {
        const i = Number(g.dataset.k);
        const was = g.classList.contains("on");
        g.classList.toggle("on", i <= k);
        if (pop && i === k && !was && !reduce()) g.classList.add("pop");
      });
    },
    get current() {
      return current;
    },
  };
}


// ------------------------------------------------------------------ persona badges
// Neutral, object-based badges: one flat icon from the persona's work in the teal accent, a thin
// outline. No faces, no skin tones. Icons are drawn in a 200×200 box; "C" is the accent, "P" the paper.
const EMBLEM_ICONS = {
  hands: (C, P) => `<path d="M30 92 H52 V132 H30 Z M148 92 H170 V132 H148 Z" fill="${C}" stroke="none"/>
    <path d="M52 98 L82 84 q8 -3 15 1 L124 102" stroke-width="7"/>
    <path d="M148 98 L120 88 q-8 -3 -15 2 L86 104 q-8 6 -2 12 q6 5 13 0 l12 -8" stroke-width="7"/>
    <path d="M52 126 L74 132 q8 2 13 -3 l5 -4 M70 134 q8 6 15 1 l8 -6 M86 138 q8 5 14 0 l12 -9 M148 126 l-20 -16 q-6 -5 -12 0 l-10 8 q-6 6 0 11 q6 4 12 -1" stroke-width="6"/>`,
  milestones: (C, P) => {
    const ms = (x, base, w, h) => `<path d="M${x - w / 2} ${base} V${base - h + w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 V${base} Z" fill="${P}" stroke-width="6"/>
      <path d="M${x - w / 2} ${base - h + w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 Z" fill="${C}" stroke-width="6"/>
      <path d="M${x - w / 4} ${base - h * 0.32} H${x + w / 4}" stroke-width="4"/>`;
    return `${ms(54, 150, 34, 54)}${ms(146, 150, 34, 54)}${ms(100, 150, 42, 82)}<path d="M30 152 H170" stroke-width="6"/>`;
  },
  binoculars: (C, P) => `<path d="M62 64 H86 V96 M138 64 H114 V96" stroke-width="7"/>
    <rect x="86" y="80" width="28" height="22" rx="4" fill="${C}" stroke="none"/>
    <circle cx="68" cy="124" r="28" stroke-width="7"/><circle cx="132" cy="124" r="28" stroke-width="7"/>
    <path d="M44 120 L56 70 H80 L94 110 M156 120 L144 70 H120 L106 110" stroke-width="7"/>
    <circle cx="68" cy="124" r="11" fill="${C}" stroke="none"/><circle cx="132" cy="124" r="11" fill="${C}" stroke="none"/>`,
  padlock: (C, P) => `<path d="M70 94 V72 a30 30 0 0 1 60 0 V94" stroke-width="9"/>
    <rect x="52" y="92" width="96" height="74" rx="10" fill="${C}" stroke="none"/>
    <circle cx="100" cy="122" r="10" fill="${P}" stroke="none"/><path d="M100 128 V146" stroke="${P}" stroke-width="8"/>`,
  wrench: (C, P) => `<g transform="rotate(45 100 100)"><rect x="92" y="70" width="16" height="96" rx="6" fill="${C}" stroke="none"/>
      <circle cx="100" cy="58" r="26" fill="${C}" stroke="none"/><rect x="91" y="26" width="18" height="30" fill="${P}" stroke="none"/>
      <circle cx="100" cy="156" r="6" fill="${P}" stroke="none"/></g>`,
};

/** A round persona badge: one object from the persona's work, in the teal accent, inside a thin outline. */
export function emblem(badge, size = 200) {
  const icon = EMBLEM_ICONS[badge] || EMBLEM_ICONS.milestones;
  const C = PAL.teal;
  const P = PAL.white;
  return `<svg class="emblem" viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-hidden="true" focusable="false">
    <circle cx="100" cy="100" r="96" fill="${PAL.white}" stroke="${PAL.teal}" stroke-width="3"/>
    <g transform="translate(100 100) scale(.78) translate(-100 -100)" fill="none" stroke="${C}" stroke-linecap="round" stroke-linejoin="round">${icon(C, P)}</g></svg>`;
}

// ------------------------------------------------------------------ board motifs (flat, teal and grey)
const T = PAL.teal;
const W = PAL.white;
const G = PAL.ink2;
export const PIT_ICONS = {
  info: `<svg viewBox="0 0 120 150" aria-hidden="true"><rect x="10" y="8" width="100" height="100" rx="14" fill="${W}" stroke="${T}" stroke-width="4"/><circle cx="60" cy="38" r="9" fill="${T}"/><rect x="51" y="52" width="18" height="38" rx="3" fill="${T}"/><rect x="56" y="108" width="8" height="40" fill="${G}"/></svg>`,
  petrol: `<svg viewBox="0 0 120 140" aria-hidden="true"><rect x="20" y="20" width="60" height="110" rx="8" fill="${W}" stroke="${T}" stroke-width="4"/><rect x="30" y="32" width="40" height="28" rx="3" fill="${PAL.tint}"/><path d="M80 50 h14 q10 0 10 10 v50 q0 8 -8 8" fill="none" stroke="${T}" stroke-width="5" stroke-linecap="round"/><rect x="14" y="128" width="72" height="6" rx="3" fill="${G}"/></svg>`,
};
