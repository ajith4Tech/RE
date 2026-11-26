// The Ride: one world for backdrops, road and riders. Shared by the projector and tools/backdrops.mjs.
//
// Geometry (backdrop pixels, 1920×1080). The projector draws every backdrop at 1600×900, 80 px wider than the
// stage on each side (room for parallax) and 45 px above it:  stage y = backdrop y × 5/6 − 45.
//   HORIZON    600 → stage 455   every scene's far horizon sits on this line
//   ROAD_EDGE  887 → stage 694   the near ground meets the road here (the top of the asphalt)
// Time of day follows the story: dawn in Bengaluru, morning at the workbench, late morning at the forest edge,
// afternoon in the village, late afternoon at the pump, golden hour in Nagpur, dusk in Jhansi, evening lights at
// the palace. Each scene has one light (colour and direction) that the riders share.
export const HORIZON = 600;
export const ROAD_EDGE = 887;
export const GROUND_T = 0.74; // how far the near ground leans from the hazy horizon colour to the scene's dark

export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const mix = (a, b, t) => "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
/** A depth tint: 0 = far (hazy, near the horizon colour), 1 = nearest silhouette. */
export const depth = (pal, t) => mix(mix(pal.horizon, pal.mid, 0.35), pal.dark, t);

/** Sky palettes. night: 0 (no stars or moon) … 1 (full night sky). sun: [x, y] of the light in a 1920 frame
 *  (panoramas repeat it), disc: whether the sun itself shows. light: the colour that rims the riders. */
export const PAL = {
  prologue: { time: "Dawn", top: "#17304e", mid: "#56708e", horizon: "#f0b07a", glow: "#ffd49a", dark: "#0a1218", night: 0.35, sun: [1180, 640], disc: false, light: "#ffc890" },
  workbench: { time: "Morning", top: "#3f7fa2", mid: "#8dbccb", horizon: "#f4dcb2", glow: "#fff1cc", dark: "#061312", night: 0, sun: [960, 380], disc: false, light: "#fff0c8" },
  forest: { time: "Late morning", top: "#3a7896", mid: "#86b4b2", horizon: "#e6dfb0", glow: "#fff4c8", dark: "#07140c", night: 0, sun: [520, 250], disc: true, light: "#fff2c0" },
  village: { time: "Afternoon", top: "#4878a0", mid: "#c3a57a", horizon: "#f2cd8a", glow: "#fff0c0", dark: "#170c07", night: 0, sun: [1480, 330], disc: true, light: "#ffe3a0" },
  pump: { time: "Late afternoon", top: "#3a6286", mid: "#c08458", horizon: "#f3b45e", glow: "#ffe0a0", dark: "#120a06", night: 0, sun: [1330, 470], disc: true, light: "#ffd08a" },
  records: { time: "Golden hour", top: "#2c3a6a", mid: "#ad6c58", horizon: "#f5a04a", glow: "#ffd08a", dark: "#05050f", night: 0.1, sun: [760, 560], disc: true, light: "#ffb870" },
  bridge: { time: "Dusk", top: "#272046", mid: "#984852", horizon: "#ef8a5a", glow: "#ffb98a", dark: "#110807", night: 0.45, sun: [1000, 615], disc: false, light: "#ff9e70" },
  palace: { time: "Evening", top: "#121838", mid: "#46386a", horizon: "#bf6a6c", glow: "#ffd28c", dark: "#0a0812", night: 1, sun: [960, 560], disc: false, light: "#ffd28c" },
  "road-1": { time: "Morning", top: "#38728f", mid: "#7aa8b0", horizon: "#ead0a2", glow: "#fff0c8", dark: "#09130e", night: 0, sun: [600, 280], disc: true, light: "#fff0c8" },
  "road-2": { time: "Afternoon", top: "#3f7096", mid: "#ad936c", horizon: "#f1c27a", glow: "#ffe6a8", dark: "#0c0a07", night: 0, sun: [1300, 380], disc: true, light: "#ffdc98" },
  "road-3": { time: "Golden hour into dusk", top: "#31325c", mid: "#a05848", horizon: "#f29a52", glow: "#ffc890", dark: "#100806", night: 0.25, sun: [1100, 570], disc: true, light: "#ffab70" },
  "road-4": { time: "Dusk into evening", top: "#1b1a3e", mid: "#683a60", horizon: "#de7a5e", glow: "#ffd08a", dark: "#0b0912", night: 0.8, sun: [960, 610], disc: false, light: "#ffc890" },
};

/** What lines the road in each scene (the bridging layer between backdrop and asphalt). */
const VERGE = { prologue: "city", workbench: "workshop", forest: "forest", village: "village", pump: "highway", records: "city", bridge: "rocky", palace: "palace", "road-1": "village", "road-2": "highway", "road-3": "rocky", "road-4": "avenue" };

export const groundOf = (name) => depth(PAL[name] || PAL.prologue, GROUND_T);

/** The scene's light for the riders: colour, and direction (-1 from the left … 1 from the right). */
export function lightOf(name) {
  const p = PAL[name] || PAL.prologue;
  return { color: p.light, dir: Math.max(-1, Math.min(1, (p.sun[0] - 960) / 700)), low: p.sun[1] > 520 };
}

// ------------------------------------------------------------------ the verge: a repeating 1440×120 strip
const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const r1 = (v) => Math.round(v * 10) / 10;

/** The verge for a scene as an SVG string (1440×120, tiles sideways). The solid band at the bottom is the
 *  backdrop's own ground colour, so the landscape runs into it without a seam; its lower edge overlaps the road. */
export function vergeSVG(name) {
  const kind = VERGE[name] || "village";
  const p = PAL[name] || PAL.prologue;
  const W = 1440, H = 120, TOP = 86;
  const G = groundOf(name);
  const D = mix(G, "#000000", 0.35); // shadowed items
  const M = mix(G, p.horizon, 0.18); // items catching a little sky
  const L = p.light;
  const r = rng([...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const out = [];
  const wrap = (x, s, f) => { out.push(f(x)); if (x < s) out.push(f(x + W)); if (x > W - s) out.push(f(x - W)); };
  // The band: a slightly uneven top edge, lit along its crest
  let d = `M0 ${H}`;
  const ph = r() * 6.28;
  const ey = (x) => TOP + 3 * Math.sin((x / W) * 2 * Math.PI * 7 + ph) + 2 * Math.sin((x / W) * 2 * Math.PI * 19);
  for (let x = 0; x <= W; x += 12) d += ` L${x} ${r1(ey(x))}`;
  out.push(`<path d="${d} L${W} ${H} Z" fill="${G}"/>`);
  let crest = `M0 ${r1(ey(0))}`;
  for (let x = 12; x <= W; x += 12) crest += ` L${x} ${r1(ey(x))}`;
  out.push(`<path d="${crest}" stroke="${L}" stroke-opacity=".28" stroke-width="2" fill="none"/>`);

  const tuft = (x, s, c) => `<path d="M${r1(x - s * 0.5)} ${TOP + 4} Q${r1(x - s * 0.35)} ${r1(TOP - s * 0.6)} ${r1(x - s * 0.1)} ${r1(TOP - s)} Q${r1(x - s * 0.05)} ${r1(TOP - s * 0.4)} ${r1(x)} ${TOP + 2} Q${r1(x + s * 0.1)} ${r1(TOP - s * 0.7)} ${r1(x + s * 0.4)} ${r1(TOP - s * 0.85)} Q${r1(x + s * 0.25)} ${r1(TOP - s * 0.3)} ${r1(x + s * 0.5)} ${TOP + 4} Z" fill="${c}"/>`;
  const stone = (x, s, c) => `<ellipse cx="${r1(x)}" cy="${r1(TOP + 2 - s * 0.25)}" rx="${r1(s)}" ry="${r1(s * 0.55)}" fill="${c}"/><path d="M${r1(x - s * 0.7)} ${r1(TOP - s * 0.5)} Q${r1(x)} ${r1(TOP - s * 0.95)} ${r1(x + s * 0.6)} ${r1(TOP - s * 0.55)}" stroke="${L}" stroke-opacity=".3" stroke-width="1.5" fill="none"/>`;
  const shrub = (x, s, c) => `<g fill="${c}"><ellipse cx="${r1(x)}" cy="${r1(TOP - s * 0.35)}" rx="${r1(s * 0.55)}" ry="${r1(s * 0.42)}"/><ellipse cx="${r1(x - s * 0.45)}" cy="${r1(TOP - s * 0.18)}" rx="${r1(s * 0.38)}" ry="${r1(s * 0.28)}"/><ellipse cx="${r1(x + s * 0.48)}" cy="${r1(TOP - s * 0.2)}" rx="${r1(s * 0.36)}" ry="${r1(s * 0.27)}"/></g><path d="M${r1(x - s * 0.5)} ${r1(TOP - s * 0.55)} Q${r1(x)} ${r1(TOP - s * 0.85)} ${r1(x + s * 0.45)} ${r1(TOP - s * 0.6)}" stroke="${L}" stroke-opacity=".25" stroke-width="2" fill="none"/>`;
  const fern = (x, s, c) => [-50, -25, 0, 25, 50].map((a) => { const t = (a * Math.PI) / 180; return `<path d="M${r1(x)} ${TOP + 2} Q${r1(x + Math.sin(t) * s * 0.5)} ${r1(TOP - s * 0.7)} ${r1(x + Math.sin(t) * s * 0.95)} ${r1(TOP - Math.cos(t) * s * 0.75)}" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>`; }).join("");
  /** An Indian highway milestone (kept for reference; the projector's own milestone sign does this job): white stone, coloured cap (yellow on national highways). */
  const milestone = (x, cap, s = 34) => `<g><path d="M${r1(x - s * 0.36)} ${TOP + 6} L${r1(x - s * 0.36)} ${r1(TOP - s * 0.62)} Q${r1(x - s * 0.36)} ${r1(TOP - s)} ${r1(x)} ${r1(TOP - s)} Q${r1(x + s * 0.36)} ${r1(TOP - s)} ${r1(x + s * 0.36)} ${r1(TOP - s * 0.62)} L${r1(x + s * 0.36)} ${TOP + 6} Z" fill="${mix("#e9e2d2", G, 0.42)}"/><path d="M${r1(x - s * 0.36)} ${r1(TOP - s * 0.62)} Q${r1(x - s * 0.36)} ${r1(TOP - s)} ${r1(x)} ${r1(TOP - s)} Q${r1(x + s * 0.36)} ${r1(TOP - s)} ${r1(x + s * 0.36)} ${r1(TOP - s * 0.62)} Z" fill="${mix(cap, G, 0.4)}"/><rect x="${r1(x - s * 0.2)}" y="${r1(TOP - s * 0.42)}" width="${r1(s * 0.4)}" height="3" fill="${mix("#555555", G, 0.5)}"/><path d="M${r1(x - s * 0.36)} ${r1(TOP - s * 0.62)} Q${r1(x - s * 0.36)} ${r1(TOP - s)} ${r1(x)} ${r1(TOP - s)}" stroke="${L}" stroke-opacity=".45" stroke-width="1.5" fill="none"/></g>`;
  /** Painted kerb stones along the road edge (black and white in towns, black and yellow on highways). */
  const kerb = (a, b, h = 10) => { for (let x = 0, k = 0; x < W; x += 36, k++) out.push(`<rect x="${x}" y="${H - 18 - h}" width="35" height="${h}" fill="${mix(k % 2 ? a : b, G, 0.45)}"/>`); out.push(`<rect x="0" y="${H - 18 - h}" width="${W}" height="2" fill="${L}" opacity=".22"/>`); };
  const scatter = (count, fn, [a, b]) => { for (let i = 0; i < count; i++) { const x = (W / count) * (i + 0.5) + (r() - 0.5) * (W / count) * 0.8; const s = a + r() * (b - a); wrap(x, s * 1.2, (xx) => fn(xx, s)); } };

  switch (kind) {
    case "forest":
      scatter(18, (x, s) => fern(x, s, r() < 0.5 ? D : M), [22, 40]);
      scatter(26, (x, s) => tuft(x, s, r() < 0.5 ? D : M), [14, 30]);
      scatter(7, (x, s) => stone(x, s, M), [8, 16]);
      break;
    case "village":
      scatter(10, (x, s) => shrub(x, s, D), [26, 46]);
      scatter(30, (x, s) => tuft(x, s, r() < 0.6 ? D : M), [12, 26]);
      scatter(9, (x, s) => stone(x, s, M), [6, 14]);
      break;
    case "highway":
      kerb("#e8e2d4", "#2a2622", 8);
      scatter(22, (x, s) => tuft(x, s, mix(D, "#8a6a3a", 0.25)), [12, 24]);
      scatter(5, (x, s) => shrub(x, s, D), [22, 36]);
      scatter(12, (x, s) => stone(x, s, M), [4, 9]);
      break;
    case "rocky":
      scatter(9, (x, s) => stone(x, s, r() < 0.5 ? D : M), [14, 28]);
      scatter(8, (x, s) => shrub(x, s, mix(D, "#5a3a20", 0.2)), [18, 32]);
      scatter(16, (x, s) => tuft(x, s, D), [10, 20]);
      break;
    case "city":
      kerb("#e8e2d4", "#1c1a18");
      out.push(`<rect x="0" y="${TOP + 2}" width="${W}" height="${H - 30 - TOP}" fill="${mix(G, "#8a8478", 0.12)}"/>`);
      for (const x of [160, 620, 1060]) wrap(x, 40, (xx) => `<rect x="${xx - 22}" y="${TOP - 18}" width="44" height="22" fill="${mix(D, "#7a3a20", 0.3)}"/>${shrub(xx, 30, D)}`);
      scatter(10, (x, s) => tuft(x, s, D), [8, 16]);
      break;
    case "workshop":
      kerb("#e8e2d4", "#1c1a18");
      out.push(`<rect x="0" y="${TOP + 2}" width="${W}" height="${H - 30 - TOP}" fill="${mix(G, "#7a7a70", 0.15)}"/>`);
      wrap(300, 40, (x) => `<rect x="${x - 22}" y="${TOP - 26}" width="44" height="30" rx="3" fill="${D}"/><rect x="${x - 22}" y="${TOP - 26}" width="44" height="3" fill="${L}" opacity=".3"/>`);
      wrap(1150, 40, (x) => `<rect x="${x - 16}" y="${TOP - 20}" width="32" height="22" fill="${mix(D, "#7a3a20", 0.3)}"/>${shrub(x, 30, D)}`);
      scatter(8, (x, s) => stone(x, s, M), [4, 8]);
      break;
    case "palace":
    case "avenue": {
      kerb("#e8e2d4", "#3a3440", 9);
      scatter(14, (x, s) => shrub(x, s, D), [16, 26]);
      for (let x = 90; x < W; x += 360) out.push(`<rect x="${x - 3}" y="${TOP - 58}" width="6" height="62" fill="${mix(D, "#000000", 0.3)}"/><circle cx="${x}" cy="${TOP - 62}" r="7" fill="${L}"/><circle cx="${x}" cy="${TOP - 62}" r="22" fill="${L}" opacity=".18"/>`);
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
}
