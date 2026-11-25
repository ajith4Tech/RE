// The Ride — "The Highway" artwork. Flat, original SVG only: no maps, no logos, no brands.
//   Band:      a horizontal road strip along the bottom of the projector, with
//              regional landscape silhouettes (parallax), milestone stones and the bike.
//   Portraits: flat persona portraits in one consistent style.
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

const PIT_COLORS = { petrol: PAL.red, landslide: PAL.yellow, viewpoint: PAL.green, mechanic: PAL.yellow, checkpost: PAL.red, chai: PAL.red };
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
export function buildBand(svg, route, shortPlace) {
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
    marks += r.kind === "pitstop" ? pitMarker(itemX(k), r.pitType, (r.stamp || "").toUpperCase()) : milestone(itemX(k), esc(shortPlace(r.place)).toUpperCase(), `${r.km} km`);
  });

  svg.innerHTML = `
    <rect width="1920" height="${BAND_H}" fill="${PAL.sky}"/>
    <g id="farLayer">${far}</g>
    <g id="landLayer">${land}</g>
    <g id="worldLayer">${ground}${marks}</g>
    <g id="bikeLayer" transform="translate(${BIKE_SCREEN_X} ${ROAD_Y + 30})"><g id="bike">${BIKE_SVG}</g></g>`;

  const farL = svg.querySelector("#farLayer");
  const landL = svg.querySelector("#landLayer");
  const worldL = svg.querySelector("#worldLayer");
  const bike = svg.querySelector("#bike");
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

// ------------------------------------------------------------------ portraits (one flat style)
export function portrait(p = {}, size = 200) {
  if (p.group) {
    const one = (x, s, skin, hair) =>
      `<g transform="translate(${x} 0)"><path d="M${-40 * s} 200 q${40 * s} -${70 * s} ${80 * s} 0 z" fill="${hair === 1 ? PAL.green : hair === 2 ? PAL.red : PAL.yellow}"/><circle cx="0" cy="${200 - 92 * s}" r="${26 * s}" fill="${skin}"/><path d="M${-26 * s} ${200 - 96 * s} a${26 * s} ${26 * s} 0 0 1 ${52 * s} 0 q-${26 * s} -${12 * s} -${52 * s} 0z" fill="${PAL.ink}"/></g>`;
    return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-hidden="true"><rect width="200" height="200" fill="${PAL.sky}"/>${one(52, 0.95, "#8A5634", 1)}${one(148, 0.95, "#A8714A", 2)}${one(100, 1.15, "#6B4028", 3)}</svg>`;
  }
  const skin = p.skin || "#8A5634";
  const hc = p.hairColor || PAL.ink;
  const top = p.top || PAL.green;
  let back = "";
  let front = "";
  switch (p.hair) {
    case "long": back = `<path d="M58 92 q-6 70 10 92 h64 q16 -22 10 -92 q-42 -40 -84 0z" fill="${hc}"/>`; front = `<path d="M60 86 q40 -46 80 0 q-14 -14 -40 -12 q-26 -2 -40 12z" fill="${hc}"/>`; break;
    case "covered": back = `<path d="M50 96 q0 -70 50 -70 q50 0 50 70 v70 h-100z" fill="${hc}"/>`; front = `<path d="M56 98 q4 -58 44 -58 q40 0 44 58 q-10 -30 -44 -34 q-34 4 -44 34z" fill="${hc}"/>`; break;
    case "dupatta": back = `<path d="M52 92 q4 -62 48 -62 q44 0 48 62 l10 90 h-116z" fill="${hc}"/>`; front = `<path d="M60 84 q40 -40 80 0 q-16 -10 -40 -10 q-24 0 -40 10z" fill="${PAL.ink}"/>`; break;
    case "bun": back = `<circle cx="100" cy="42" r="18" fill="${hc}"/>`; front = `<path d="M62 88 q38 -50 76 0 q-12 -16 -38 -16 q-26 0 -38 16z" fill="${hc}"/>`; break;
    case "cap": front = `<path d="M62 78 q38 -40 76 0 z" fill="${PAL.green}"/><rect x="118" y="72" width="40" height="8" rx="4" fill="${PAL.green}"/>`; break;
    case "curly": front = `${[66, 80, 94, 108, 122, 134].map((x, k) => `<circle cx="${x}" cy="${70 - (k % 2) * 6}" r="13" fill="${hc}"/>`).join("")}`; break;
    case "bald": front = `<path d="M62 96 q-2 -14 6 -20 M138 96 q2 -14 -6 -20" stroke="${hc}" stroke-width="8" stroke-linecap="round"/>`; break;
    default: front = `<path d="M62 86 q38 -48 76 0 q-10 -10 -38 -12 q-28 2 -38 12z" fill="${hc}"/>`;
  }
  const ex = p.extra || "";
  let extra = "";
  if (ex.includes("glasses")) extra += `<g fill="none" stroke="${PAL.ink}" stroke-width="4"><circle cx="86" cy="102" r="11"/><circle cx="114" cy="102" r="11"/><path d="M97 102h6"/></g>`;
  if (ex.includes("beard")) extra += `<path d="M70 110 q30 56 60 0 q-6 26 -30 28 q-24 -2 -30 -28z" fill="${hc}"/>`;
  if (ex === "moustache" || ex.includes("white-moustache")) extra += `<path d="M86 124 q14 -8 28 0 q-14 4 -28 0z" fill="${ex.includes("white") ? "#E8E2D4" : PAL.ink}"/>`;
  if (ex === "stubble") extra += `<path d="M72 116 q28 40 56 0" fill="none" stroke="${PAL.ink}" stroke-width="6" opacity=".35"/>`;
  if (ex === "earrings") extra += `<circle cx="64" cy="118" r="5" fill="${PAL.yellow}"/><circle cx="136" cy="118" r="5" fill="${PAL.yellow}"/>`;
  if (ex === "bindi") extra += `<circle cx="100" cy="86" r="4" fill="${PAL.red}"/>`;
  if (ex === "nosering") extra += `<circle cx="108" cy="116" r="5" fill="none" stroke="${PAL.yellow}" stroke-width="2.5"/>`;
  const eyes = ex.includes("glasses") ? `<circle cx="86" cy="102" r="3" fill="${PAL.ink}"/><circle cx="114" cy="102" r="3" fill="${PAL.ink}"/>` : `<circle cx="86" cy="102" r="4" fill="${PAL.ink}"/><circle cx="114" cy="102" r="4" fill="${PAL.ink}"/>`;
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-hidden="true">
    <rect width="200" height="200" fill="${PAL.sky}"/>${back}
    <path d="M36 200 q8 -52 64 -54 q56 2 64 54z" fill="${top}"/>
    <rect x="88" y="128" width="24" height="24" fill="${skin}"/>
    <ellipse cx="100" cy="102" rx="38" ry="44" fill="${skin}"/>
    <ellipse cx="62" cy="106" rx="6" ry="9" fill="${skin}"/><ellipse cx="138" cy="106" rx="6" ry="9" fill="${skin}"/>
    ${front}${eyes}<path d="M90 128 q10 8 20 0" fill="none" stroke="${PAL.ink}" stroke-width="3" stroke-linecap="round"/>${extra}
  </svg>`;
}

// ------------------------------------------------------------------ hand-painted pitstop motifs
export const PIT_ICONS = {
  petrol: `<svg viewBox="0 0 120 140" aria-hidden="true"><rect x="20" y="20" width="60" height="110" rx="6" fill="${PAL.red}" stroke="${PAL.ink}" stroke-width="5"/><rect x="30" y="32" width="40" height="28" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="4"/><text x="50" y="53" text-anchor="middle" font-family="Signage" font-weight="800" font-size="18" fill="${PAL.ink}">00.0</text><path d="M80 50 h14 q10 0 10 10 v50 q0 8 -8 8" fill="none" stroke="${PAL.ink}" stroke-width="6" stroke-linecap="round"/><rect x="14" y="126" width="72" height="10" fill="${PAL.ink}"/></svg>`,
  landslide: `<svg viewBox="0 0 140 120" aria-hidden="true"><path d="M70 8 L132 112 H8 Z" fill="${PAL.yellow}" stroke="${PAL.ink}" stroke-width="6" stroke-linejoin="round"/><circle cx="58" cy="86" r="12" fill="${PAL.ink}"/><circle cx="80" cy="92" r="9" fill="${PAL.ink}"/><circle cx="70" cy="66" r="9" fill="${PAL.ink}"/><path d="M30 104 H110" stroke="${PAL.ink}" stroke-width="5"/></svg>`,
  viewpoint: `<svg viewBox="0 0 140 110" aria-hidden="true"><rect x="16" y="30" width="44" height="60" rx="18" fill="${PAL.ink}"/><rect x="80" y="30" width="44" height="60" rx="18" fill="${PAL.ink}"/><rect x="54" y="42" width="32" height="20" fill="${PAL.ink}"/><circle cx="38" cy="78" r="12" fill="${PAL.chalk}"/><circle cx="102" cy="78" r="12" fill="${PAL.chalk}"/></svg>`,
  mechanic: `<svg viewBox="0 0 140 120" aria-hidden="true"><path d="M30 96 L84 42" stroke="${PAL.ink}" stroke-width="14" stroke-linecap="round"/><path d="M84 42 a22 22 0 1 1 18 10 l-8 -8 l10 -10 l-8 -8z" fill="${PAL.ink}"/><circle cx="104" cy="92" r="16" fill="none" stroke="${PAL.ink}" stroke-width="9"/></svg>`,
  checkpost: `<svg viewBox="0 0 160 100" aria-hidden="true"><rect x="14" y="20" width="14" height="76" fill="${PAL.ink}"/><rect x="28" y="30" width="122" height="16" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="3"/>${[0, 1, 2, 3].map((k) => `<rect x="${30 + k * 30}" y="30" width="15" height="16" fill="${PAL.red}"/>`).join("")}</svg>`,
  chai: `<svg viewBox="0 0 120 130" aria-hidden="true"><path d="M30 50 h56 l-6 70 h-44 z" fill="${PAL.chalk}" stroke="${PAL.ink}" stroke-width="5" stroke-linejoin="round"/><path d="M34 66 h48 l-4 50 h-40 z" fill="#B5652A"/><path d="M48 40 q-8 -12 0 -24 M66 40 q-8 -12 0 -24" fill="none" stroke="${PAL.ink}" stroke-width="4" stroke-linecap="round"/></svg>`,
};
