// The Ride — "The Highway" artwork. Flat, original SVG only: no maps, no logos, no brands.
//   Band:      a horizontal road strip along the bottom of the projector, with
//              regional landscape silhouettes (parallax), milestone stones and the bike.
//   Emblems:   neutral rubber-stamp persona badges (objects, never faces).
//   Icons:     hand-painted pitstop motifs.
export const PAL = { green: "#1F5A3D", yellow: "#F2C230", red: "#B5462B", chalk: "#F5F1E6", ink: "#1A1A1A", sky: "#DCCFB8" };
const SIL = "#C3B496"; // far silhouettes (a darker dusty sky)
const SIL2 = "#AE9F80";
const GROUND = "#CDBF9F";

const NS = "http://www.w3.org/2000/svg";
const BAND_H = 300; // design height of the band; it is shown cropped from the bottom when collapsed
const HORIZON = 206;
const ROAD_Y = 236;
const ROAD_H = 44;
const SPACING = 1500; // world px between route items
const X0 = 1000;
const BIKE_SCREEN_X = 640;

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
  oldcity(x0, w) {
    let s = "";
    for (let x = x0; x < x0 + w; x += 140) {
      const h = 50 + rnd() * 50;
      s += `<rect x="${x}" y="${HORIZON - h}" width="110" height="${h}" fill="${SIL}"/>`;
      if (rnd() > 0.45) s += `<path d="M${x + 20} ${HORIZON - h} q35 -46 70 0 z" fill="${SIL}"/>`;
      for (let a = 0; a < 3; a++) s += `<path d="M${x + 12 + a * 32} ${HORIZON} v-22 a10 10 0 0 1 20 0 v22 z" fill="${SIL2}"/>`;
    }
    // a generic four-minaret gateway
    const gx = x0 + w * 0.45;
    s += `<rect x="${gx}" y="${HORIZON - 120}" width="150" height="120" fill="${SIL2}"/>`;
    for (const mx of [gx - 6, gx + 144]) s += `<rect x="${mx}" y="${HORIZON - 190}" width="12" height="190" fill="${SIL2}"/><circle cx="${mx + 6}" cy="${HORIZON - 194}" r="9" fill="${SIL2}"/>`;
    s += `<path d="M${gx + 45} ${HORIZON} v-60 a30 30 0 0 1 60 0 v60 z" fill="${SIL}"/>`;
    return s;
  },
  teak(x0, w) {
    let s = "";
    for (let x = x0; x < x0 + w; x += 70 + rnd() * 60) {
      const h = 90 + rnd() * 90;
      const c = rnd() > 0.5 ? "#6E8466" : "#5C7457";
      s += `<rect x="${x - 3}" y="${HORIZON - h * 0.55}" width="6" height="${h * 0.55}" fill="${c}"/>`;
      s += `<path d="M${x} ${HORIZON - h} c${30 + rnd() * 20} ${h * 0.2} ${36} ${h * 0.5} 0 ${h * 0.55} c-36 -${h * 0.05} -${30 + rnd() * 20} -${h * 0.35} 0 -${h * 0.55} z" fill="${c}"/>`;
    }
    return s;
  },
  orange(x0, w) {
    let s = "";
    for (let row = 0; row < 2; row++)
      for (let x = x0 + row * 45; x < x0 + w; x += 90) {
        const y = HORIZON - 6 - row * 22;
        s += `<rect x="${x - 3}" y="${y - 18}" width="6" height="18" fill="#5C6B4A"/><circle cx="${x}" cy="${y - 38}" r="${26}" fill="${row ? "#7E8F67" : "#6B7E58"}"/>`;
        for (let k = 0; k < 4; k++) s += `<circle cx="${x - 14 + rnd() * 28}" cy="${y - 52 + rnd() * 26}" r="4" fill="${PAL.yellow}"/>`;
      }
    return s;
  },
  bundelkhand(x0, w) {
    let s = "";
    for (let x = x0; x < x0 + w; x += 260 + rnd() * 160) {
      const h = 30 + rnd() * 40;
      s += `<path d="M${x} ${HORIZON} l40 -${h} h${120 + rnd() * 80} l40 ${h} z" fill="${SIL}"/>`;
      s += `<ellipse cx="${x + 230}" cy="${HORIZON - 6}" rx="16" ry="9" fill="${SIL2}"/>`;
      s += `<path d="M${x + 290} ${HORIZON} q6 -22 12 0 q6 -16 12 0" fill="#7E8F67"/>`;
    }
    const fx = x0 + w * 0.6;
    s += `<path d="M${fx} ${HORIZON} l20 -60 h160 l20 60 z" fill="${SIL2}"/>`;
    for (let k = 0; k < 8; k++) s += `<rect x="${fx + 26 + k * 20}" y="${HORIZON - 72}" width="10" height="12" fill="${SIL2}"/>`;
    return s;
  },
  yamuna(x0, w) {
    let s = `<rect x="${x0}" y="${HORIZON - 14}" width="${w}" height="14" fill="#9DB3A8"/>`;
    for (let x = x0 + 40; x < x0 + w; x += 300) {
      s += `<rect x="${x}" y="${HORIZON - 70}" width="120" height="56" fill="${SIL}"/><path d="M${x + 25} ${HORIZON - 70} q35 -50 70 0 z" fill="${SIL}"/>`;
      s += `<rect x="${x - 14}" y="${HORIZON - 120}" width="8" height="106" fill="${SIL2}"/><rect x="${x + 126}" y="${HORIZON - 120}" width="8" height="106" fill="${SIL2}"/>`;
    }
    return s;
  },
  palace(x0, w) {
    const px = x0 + w * 0.35;
    let s = `<rect x="${px - 260}" y="${HORIZON - 110}" width="520" height="110" fill="${SIL}"/>`;
    s += `<rect x="${px - 90}" y="${HORIZON - 150}" width="180" height="40" fill="${SIL}"/><path d="M${px - 60} ${HORIZON - 150} q60 -80 120 0 z" fill="${SIL2}"/>`;
    for (let k = 0; k < 11; k++) s += `<rect x="${px - 240 + k * 46}" y="${HORIZON - 92}" width="14" height="92" fill="${SIL2}"/>`;
    s += `<path d="M${px - 290} ${HORIZON - 110} h580 l-20 -14 h-540 z" fill="${SIL2}"/>`;
    for (let x = x0; x < x0 + w; x += 120) if (Math.abs(x - px) > 330) s += `<circle cx="${x}" cy="${HORIZON - 30}" r="24" fill="#7E8F67"/>`;
    return s;
  },
};

// ------------------------------------------------------------------ milestone + pitstop markers in the band
function milestone(x, label, km) {
  return `<g transform="translate(${x} ${ROAD_Y - 6})">
    <path d="M-34 0 V-70 a34 34 0 0 1 68 0 V0 Z" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="3"/>
    <path d="M-34 -70 a34 34 0 0 1 68 0 Z" fill="${PAL.yellow}" stroke="${PAL.ink}" stroke-width="3"/>
    <text x="0" y="-44" text-anchor="middle" class="ms-place">${label}</text>
    <text x="0" y="-16" text-anchor="middle" class="ms-km">${km}</text>
  </g>`;
}

const PIT_COLORS = { info: PAL.green, petrol: PAL.red, landslide: PAL.yellow, viewpoint: PAL.green, mechanic: PAL.yellow, checkpost: PAL.red, chai: PAL.red };
function pitMarker(x, type, label) {
  const c = PIT_COLORS[type] || PAL.red;
  const fg = c === PAL.yellow ? PAL.ink : PAL.chalk;
  if (type === "checkpost")
    return `<g transform="translate(${x} ${ROAD_Y})"><rect x="-6" y="-70" width="12" height="70" fill="${PAL.ink}"/>
      <g transform="rotate(-8)"><rect x="0" y="-66" width="150" height="12" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="2"/>${[0, 1, 2, 3, 4].map((k) => `<rect x="${k * 30}" y="-66" width="15" height="12" fill="${PAL.red}"/>`).join("")}</g></g>`;
  return `<g transform="translate(${x} ${ROAD_Y - 4})">
    <rect x="-40" y="-60" width="6" height="60" fill="${PAL.ink}"/><rect x="34" y="-60" width="6" height="60" fill="${PAL.ink}"/>
    <rect x="-58" y="-104" width="116" height="48" fill="${c}" stroke="${PAL.ink}" stroke-width="3" transform="rotate(-2)"/>
    <text x="0" y="-72" text-anchor="middle" class="pit-mini" fill="${fg}" transform="rotate(-2)">${label}</text></g>`;
}

// ------------------------------------------------------------------ the motorcycle (original, flat, facing right; ground at y=0)
export const BIKE_SVG = `
  <g class="bike-shadow"><ellipse cx="0" cy="2" rx="92" ry="7" fill="${PAL.ink}" opacity=".2"/></g>
  ${[-54, 56].map((wx) => `<g transform="translate(${wx} -30)"><g class="wheel">
    <circle r="29" fill="none" stroke="${PAL.ink}" stroke-width="11"/>
    <circle r="19" fill="none" stroke="${PAL.chalk}" stroke-width="3"/>
    <path d="M-19 0H19M0-19V19M-13-13L13 13M-13 13L13-13" stroke="${PAL.chalk}" stroke-width="2"/>
    <circle r="5" fill="${PAL.yellow}"/></g></g>`).join("")}
  <g class="bike-body">
    <path d="M-92 -34 A38 38 0 0 1 -24 -54" fill="none" stroke="${PAL.green}" stroke-width="8" stroke-linecap="round"/>
    <path d="M24 -54 A38 38 0 0 1 92 -36" fill="none" stroke="${PAL.green}" stroke-width="8" stroke-linecap="round"/>
    <path d="M-54 -30 L-14 -50 L28 -44" fill="none" stroke="${PAL.ink}" stroke-width="7" stroke-linecap="round"/>
    <path d="M10 -36 Q-14 -22 -84 -30 l-14 -2" fill="none" stroke="#B9B2A3" stroke-width="9" stroke-linecap="round"/>
    <rect x="-20" y="-66" width="42" height="28" rx="4" fill="#5E5A55" stroke="${PAL.ink}" stroke-width="3"/>
    <path d="M56 -30 L38 -96" stroke="#B9B2A3" stroke-width="8" stroke-linecap="round"/>
    <path d="M-10 -78 Q-2 -102 28 -100 Q50 -98 48 -80 Q40 -68 14 -68 Q-10 -68 -10 -78 Z" fill="${PAL.red}" stroke="${PAL.ink}" stroke-width="3"/>
    <path d="M0 -86 Q18 -96 40 -88" fill="none" stroke="${PAL.chalk}" stroke-width="5" stroke-linecap="round"/>
    <rect x="-62" y="-90" width="54" height="14" rx="7" fill="${PAL.ink}"/>
    <circle cx="54" cy="-94" r="13" fill="${PAL.yellow}" stroke="${PAL.ink}" stroke-width="4"/>
    <path d="M38 -100 L28 -120 L12 -122" fill="none" stroke="${PAL.ink}" stroke-width="6" stroke-linecap="round"/>
    <path class="scarf" d="M-16 -150 Q-44 -158 -60 -148 Q-72 -138 -88 -146 Q-76 -130 -58 -136 Q-38 -140 -16 -140 Z" fill="${PAL.red}" stroke="${PAL.ink}" stroke-width="2"/>
    <path d="M-34 -94 L4 -90 L2 -56" fill="none" stroke="${PAL.ink}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2 -56 h14" stroke="${PAL.ink}" stroke-width="10" stroke-linecap="round"/>
    <path d="M-34 -94 L-16 -142" stroke="${PAL.green}" stroke-width="26" stroke-linecap="round"/>
    <path d="M-12 -134 L8 -116 L16 -120" fill="none" stroke="${PAL.green}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="-6" cy="-164" r="18" fill="#8A5634"/>
    <path d="M-28 -164 Q-28 -190 -4 -190 Q20 -188 18 -166 Z" fill="${PAL.yellow}" stroke="${PAL.ink}" stroke-width="3"/>
    <rect x="2" y="-172" width="18" height="10" rx="5" fill="${PAL.ink}"/>
  </g>`;

// ------------------------------------------------------------------ band
// The bike lives in its own SVG layer above the band (bikeSvg), never inside the band's
// clipped box, so the rider's head stays visible when the band collapses to its short height.
export function buildBand(svg, route, shortPlace, bikeSvg) {
  seed = 11;
  const n = route.length;
  const worldW = X0 * 2 + SPACING * (n - 1) + 1920;
  svg.setAttribute("viewBox", `0 0 1920 ${BAND_H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMax slice");
  const itemX = (k) => X0 + k * SPACING;

  // Far ridge (slow), landscapes (medium), ground/road/markers/bike (camera speed)
  let far = "";
  for (let x = -400; x < worldW * 0.3 + 2400; x += 220) far += `<path d="M${x} ${HORIZON} q110 -${40 + rnd() * 40} 220 0 z" fill="#D3C5A9"/>`;
  let land = "";
  route.forEach((r, k) => {
    const cx = itemX(k) * 0.6;
    const span = SPACING * 0.6 + 200;
    land += `<g data-region="${r.landscape}">${(LAND[r.landscape] || LAND.deccan)(cx - span / 2, span)}</g>`;
  });
  // a lead-in before the first item and after the last
  land = `<g>${LAND[route[0].landscape](-1200, itemX(0) * 0.6 + 400)}</g>` + land + `<g>${LAND[route[n - 1].landscape](itemX(n - 1) * 0.6 + 400, 2400)}</g>`;

  let ground = `<rect x="-2000" y="${HORIZON}" width="${worldW + 4000}" height="${BAND_H - HORIZON}" fill="${GROUND}"/>`;
  ground += `<rect x="-2000" y="${ROAD_Y}" width="${worldW + 4000}" height="${ROAD_H}" fill="${PAL.ink}"/>`;
  ground += `<line x1="-2000" x2="${worldW + 2000}" y1="${ROAD_Y + ROAD_H / 2}" y2="${ROAD_Y + ROAD_H / 2}" stroke="${PAL.chalk}" stroke-width="4" stroke-dasharray="40 34"/>`;
  ground += `<line x1="-2000" x2="${worldW + 2000}" y1="${ROAD_Y + 3}" y2="${ROAD_Y + 3}" stroke="${PAL.yellow}" stroke-width="3"/>`;
  let marks = "";
  route.forEach((r, k) => {
    marks += r.kind === "card" ? pitMarker(itemX(k), "info", "INFO") : r.kind === "pitstop" ? pitMarker(itemX(k), r.pitType, (r.stamp || "").toUpperCase()) : milestone(itemX(k), esc(shortPlace(r.place)).toUpperCase(), `${r.km} km`);
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

  function place(worldBikeX) {
    const cam = worldBikeX - BIKE_SCREEN_X;
    worldL.setAttribute("transform", `translate(${-cam} 0)`);
    landL.setAttribute("transform", `translate(${-cam * 0.6} 0)`);
    farL.setAttribute("transform", `translate(${-cam * 0.3} 0)`);
  }
  const parkX = (k) => itemX(k) - 150; // bike stops just before the milestone
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let raf = null;

  return {
    setStop(k) {
      cancelAnimationFrame(raf);
      current = k;
      bike.classList.remove("riding");
      place(parkX(k));
    },
    ride(from, to, ms, onProgress) {
      cancelAnimationFrame(raf);
      const a = parkX(from);
      const b = parkX(to);
      bike.setAttribute("transform", b < a ? "scale(-1 1)" : "");
      if (reduce()) ms = Math.min(ms, 300);
      else bike.classList.add("riding");
      return new Promise((resolve) => {
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const e = ease(t);
          place(a + (b - a) * e);
          onProgress?.(e);
          if (t < 1) raf = requestAnimationFrame(step);
          else {
            bike.classList.remove("riding");
            bike.setAttribute("transform", "");
            current = to;
            resolve();
          }
        };
        raf = requestAnimationFrame(step);
      });
    },
    get current() {
      return current;
    },
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ------------------------------------------------------------------ persona emblems (rubber stamps)
// Neutral, object-based badges in the style of the travel-log stamps: a double ring, one flat
// icon from the persona's work, one accent colour, a slight tilt and a rough inked edge.
// No faces, no skin tones. Icons are drawn in a 200×200 box; "C" is the ink colour, "P" the paper.
const EMBLEM_ICONS = {
  book: (C) => `<path d="M100 72 C86 62 64 60 46 66 V136 C64 130 86 132 100 142 C114 132 136 130 154 136 V66 C136 60 114 62 100 72 Z" stroke-width="7"/>
    <path d="M100 72 V142" stroke-width="5"/>
    <path d="M58 86 C68 82 80 82 90 86 M58 102 C68 98 80 98 90 102 M58 118 C68 114 80 114 90 118 M110 86 C120 82 132 82 142 86 M110 102 C120 98 132 98 142 102 M110 118 C120 114 132 114 142 118" stroke-width="4"/>`,
  wheat: (C) => `<path d="M100 160 V56" stroke-width="6"/>
    ${[70, 92, 114].map((y) => `<ellipse cx="87" cy="${y}" rx="9" ry="16" transform="rotate(-38 87 ${y})" fill="${C}" stroke="none"/><ellipse cx="113" cy="${y}" rx="9" ry="16" transform="rotate(38 113 ${y})" fill="${C}" stroke="none"/>`).join("")}
    <ellipse cx="100" cy="48" rx="8" ry="15" fill="${C}" stroke="none"/>
    <path d="M100 148 q-28 -4 -38 -28 q24 0 38 20 z" fill="${C}" stroke="none"/>`,
  envelope: (C, P) => `<rect x="44" y="64" width="112" height="76" rx="6" stroke-width="7"/>
    <path d="M47 68 L100 110 L153 68" stroke-width="6"/>
    <circle cx="100" cy="112" r="20" fill="${C}" stroke="none"/>
    <path d="M100 123 c-11 -7 -15 -11 -15 -16.5 a6.6 6.6 0 0 1 15 -2.5 a6.6 6.6 0 0 1 15 2.5 c0 5.5 -4 9.5 -15 16.5z" fill="${P}" stroke="none"/>`,
  speech: (C) => `<path d="M58 56 H142 a14 14 0 0 1 14 14 V114 a14 14 0 0 1 -14 14 H96 L68 152 V128 H58 a14 14 0 0 1 -14 -14 V70 a14 14 0 0 1 14 -14 Z" stroke-width="7"/>
    ${[[72, 14], [86, 32], [100, 46], [114, 28], [128, 14]].map(([x, h]) => `<path d="M${x} ${92 - h / 2} V${92 + h / 2}" stroke-width="7"/>`).join("")}`,
  pugmark: (C) => `<g fill="${C}" stroke="none"><path d="M100 104 c-22 0 -42 18 -42 34 c0 14 14 19 23 14 c8 -4 12 -6 19 -6 c7 0 11 2 19 6 c9 5 23 0 23 -14 c0 -16 -20 -34 -42 -34z"/>
    <ellipse cx="64" cy="92" rx="11" ry="15" transform="rotate(-28 64 92)"/><ellipse cx="87" cy="68" rx="11" ry="16" transform="rotate(-8 87 68)"/>
    <ellipse cx="113" cy="68" rx="11" ry="16" transform="rotate(8 113 68)"/><ellipse cx="136" cy="92" rx="11" ry="15" transform="rotate(28 136 92)"/></g>`,
  stethoscope: (C) => `<path d="M70 48 V80 a30 30 0 0 0 60 0 V48" stroke-width="7"/>
    <circle cx="70" cy="45" r="7" fill="${C}" stroke="none"/><circle cx="130" cy="45" r="7" fill="${C}" stroke="none"/>
    <path d="M100 110 V124 a24 24 0 0 0 48 0 V116" stroke-width="7"/>
    <circle cx="148" cy="102" r="15" stroke-width="7"/><circle cx="148" cy="102" r="5" fill="${C}" stroke="none"/>`,
  tools: (C, P) => `<g transform="rotate(45 100 100)"><rect x="93" y="62" width="14" height="86" rx="5" fill="${C}" stroke="none"/>
      <circle cx="100" cy="56" r="22" fill="${C}" stroke="none"/><rect x="92" y="30" width="16" height="26" fill="${P}" stroke="none"/>
      <circle cx="100" cy="146" r="6" fill="${P}" stroke="none"/></g>
    <g transform="rotate(-45 100 100)"><path d="M90 46 H110 V132 L100 156 L90 132 Z" fill="${P}" stroke-width="6"/>
      <path d="M90 60 H110 M90 132 H110" stroke-width="5"/><path d="M96 146 L100 156 L104 146 Z" fill="${C}" stroke="none"/></g>`,
  hands: (C, P) => `<path d="M30 92 H52 V132 H30 Z M148 92 H170 V132 H148 Z" fill="${C}" stroke="none"/>
    <path d="M52 98 L82 84 q8 -3 15 1 L124 102" stroke-width="7"/>
    <path d="M148 98 L120 88 q-8 -3 -15 2 L86 104 q-8 6 -2 12 q6 5 13 0 l12 -8" stroke-width="7"/>
    <path d="M52 126 L74 132 q8 2 13 -3 l5 -4 M70 134 q8 6 15 1 l8 -6 M86 138 q8 5 14 0 l12 -9 M148 126 l-20 -16 q-6 -5 -12 0 l-10 8 q-6 6 0 11 q6 4 12 -1" stroke-width="6"/>`,
  needle: (C, P) => `<path d="M130 64 C166 52 172 102 132 114 C96 126 50 114 50 142 C50 160 76 166 94 154" stroke-width="5"/>
    <g transform="rotate(40 100 100)"><rect x="93" y="36" width="14" height="116" rx="7" fill="${C}" stroke="none"/>
      <path d="M93 148 L100 174 L107 148 Z" fill="${C}" stroke="none"/><ellipse cx="100" cy="54" rx="3.5" ry="10" fill="${P}" stroke="none"/></g>`,
  milestones: (C, P) => {
    const ms = (x, base, w, h) => `<path d="M${x - w / 2} ${base} V${base - h + w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 V${base} Z" fill="${P}" stroke-width="6"/>
      <path d="M${x - w / 2} ${base - h + w / 2} a${w / 2} ${w / 2} 0 0 1 ${w} 0 Z" fill="${C}" stroke-width="6"/>
      <path d="M${x - w / 4} ${base - h * 0.32} H${x + w / 4}" stroke-width="4"/>`;
    return `${ms(54, 150, 34, 54)}${ms(146, 150, 34, 54)}${ms(100, 150, 42, 82)}<path d="M30 152 H170" stroke-width="6"/>`;
  },
  compass: (C, P) => `<circle cx="100" cy="100" r="58" stroke-width="7"/>
    ${[0, 90, 180, 270].map((a) => `<path d="M100 48 V58" stroke-width="6" transform="rotate(${a} 100 100)"/>`).join("")}
    <path d="M100 62 L114 100 L100 138 L86 100 Z" fill="${C}" stroke="none" transform="rotate(35 100 100)"/>
    <path d="M100 100 L114 100 L100 138 L86 100 Z" fill="${P}" stroke-width="4" transform="rotate(35 100 100)"/>
    <circle cx="100" cy="100" r="6" fill="${C}" stroke="none"/>`,
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
  braille: (C) => `<rect x="58" y="44" width="84" height="112" rx="14" stroke-width="7"/>
    ${[[82, 74, 1], [118, 74, 0], [82, 100, 1], [118, 100, 1], [82, 126, 0], [118, 126, 1]].map(([x, y, f]) => `<circle cx="${x}" cy="${y}" r="9" ${f ? `fill="${C}" stroke="none"` : `stroke-width="4"`}/>`).join("")}`,
  microphone: (C) => `<rect x="80" y="38" width="40" height="68" rx="20" stroke-width="7"/>
    <path d="M86 60 H114 M86 74 H114 M86 88 H114" stroke-width="4"/>
    <path d="M64 90 a36 36 0 0 0 72 0" stroke-width="7"/><path d="M100 126 V150 M76 152 H124" stroke-width="7"/>`,
};
export const EMBLEM_NAMES = Object.keys(EMBLEM_ICONS);
const EMBLEM_INK = { green: PAL.green, red: PAL.red, ink: PAL.ink, yellow: PAL.ink };
let emblemSeq = 0;

/** A round rubber-stamp badge: { icon, color: green|red|yellow|ink }. `key` seeds the tilt (−3°…3°).
 *  { group: [badge, …] } draws several badges side by side (e.g. "Everyone from the road"). */
export function emblem(e = {}, size = 200, key = "") {
  if (Array.isArray(e.group)) {
    const n = e.group.length;
    const each = Math.round(size / Math.min(n, 2)) - 2;
    return `<span class="emblem-group" style="display:grid;grid-template-columns:repeat(${Math.min(n, 2)},${each}px);gap:2px;width:${size}px">${e.group.map((g, k) => emblem(g, each, `${key}${k}`)).join("")}</span>`;
  }
  const icon = EMBLEM_ICONS[e.icon] || EMBLEM_ICONS.milestones;
  const C = EMBLEM_INK[e.color] || PAL.green;
  const P = e.color === "yellow" ? PAL.yellow : PAL.chalk;
  let h = 7;
  for (const ch of String(key || e.icon)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  const rot = ((h % 61) - 30) / 10;
  const id = `ink${++emblemSeq}`;
  return `<svg class="emblem" viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-hidden="true" focusable="false">
    <defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${h % 97}" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="1" seed="${(h % 89) + 3}" result="s"/>
      <feColorMatrix in="s" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4 0 0 0 3.3" result="m"/>
      <feComposite in="rough" in2="m" operator="in"/></filter></defs>
    <circle cx="100" cy="100" r="96" fill="${P}"/>
    ${e.color === "yellow" ? "" : `<circle cx="100" cy="100" r="92" fill="${C}" opacity=".07"/>`}
    <g transform="rotate(${rot} 100 100)" filter="url(#${id})">
      <circle cx="100" cy="100" r="90" fill="none" stroke="${C}" stroke-width="7"/>
      <circle cx="100" cy="100" r="78" fill="none" stroke="${C}" stroke-width="2.5"/>
      <circle cx="16" cy="100" r="3" fill="${C}"/><circle cx="184" cy="100" r="3" fill="${C}"/>
      <g transform="translate(100 100) scale(.84) translate(-100 -100)" fill="none" stroke="${C}" stroke-linecap="round" stroke-linejoin="round">${icon(C, P)}</g>
    </g></svg>`;
}

// ------------------------------------------------------------------ hand-painted pitstop motifs
export const PIT_ICONS = {
  info: `<svg viewBox="0 0 120 150" aria-hidden="true"><rect x="10" y="8" width="100" height="100" rx="12" fill="${PAL.green}" stroke="${PAL.ink}" stroke-width="6"/><rect x="18" y="16" width="84" height="84" rx="7" fill="none" stroke="${PAL.chalk}" stroke-width="4"/><circle cx="60" cy="38" r="9" fill="${PAL.chalk}"/><rect x="51" y="52" width="18" height="38" rx="3" fill="${PAL.chalk}"/><rect x="54" y="108" width="12" height="40" fill="${PAL.ink}"/></svg>`,
  petrol: `<svg viewBox="0 0 120 140" aria-hidden="true"><rect x="20" y="20" width="60" height="110" rx="6" fill="${PAL.red}" stroke="${PAL.ink}" stroke-width="5"/><rect x="30" y="32" width="40" height="28" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="4"/><text x="50" y="53" text-anchor="middle" font-family="Signage" font-weight="800" font-size="18" fill="${PAL.ink}">00.0</text><path d="M80 50 h14 q10 0 10 10 v50 q0 8 -8 8" fill="none" stroke="${PAL.ink}" stroke-width="6" stroke-linecap="round"/><rect x="14" y="126" width="72" height="10" fill="${PAL.ink}"/></svg>`,
  landslide: `<svg viewBox="0 0 140 120" aria-hidden="true"><path d="M70 8 L132 112 H8 Z" fill="${PAL.yellow}" stroke="${PAL.ink}" stroke-width="6" stroke-linejoin="round"/><circle cx="58" cy="86" r="12" fill="${PAL.ink}"/><circle cx="80" cy="92" r="9" fill="${PAL.ink}"/><circle cx="70" cy="66" r="9" fill="${PAL.ink}"/><path d="M30 104 H110" stroke="${PAL.ink}" stroke-width="5"/></svg>`,
  viewpoint: `<svg viewBox="0 0 140 110" aria-hidden="true"><rect x="16" y="30" width="44" height="60" rx="18" fill="${PAL.ink}"/><rect x="80" y="30" width="44" height="60" rx="18" fill="${PAL.ink}"/><rect x="54" y="42" width="32" height="20" fill="${PAL.ink}"/><circle cx="38" cy="78" r="12" fill="${PAL.chalk}"/><circle cx="102" cy="78" r="12" fill="${PAL.chalk}"/></svg>`,
  mechanic: `<svg viewBox="0 0 140 120" aria-hidden="true"><path d="M30 96 L84 42" stroke="${PAL.ink}" stroke-width="14" stroke-linecap="round"/><path d="M84 42 a22 22 0 1 1 18 10 l-8 -8 l10 -10 l-8 -8z" fill="${PAL.ink}"/><circle cx="104" cy="92" r="16" fill="none" stroke="${PAL.ink}" stroke-width="9"/></svg>`,
  checkpost: `<svg viewBox="0 0 160 100" aria-hidden="true"><rect x="14" y="20" width="14" height="76" fill="${PAL.ink}"/><rect x="28" y="30" width="122" height="16" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="3"/>${[0, 1, 2, 3].map((k) => `<rect x="${30 + k * 30}" y="30" width="15" height="16" fill="${PAL.red}"/>`).join("")}</svg>`,
  chai: `<svg viewBox="0 0 120 130" aria-hidden="true"><path d="M30 50 h56 l-6 70 h-44 z" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="5" stroke-linejoin="round"/><path d="M34 66 h48 l-4 50 h-40 z" fill="#B5652A"/><path d="M48 40 q-8 -12 0 -24 M66 40 q-8 -12 0 -24" fill="none" stroke="${PAL.ink}" stroke-width="4" stroke-linecap="round"/></svg>`,
};
