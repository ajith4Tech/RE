// The Ride: backdrop generator. Draws every stop's backdrop as a layered flat-vector SVG (one shared
// style: sky → hazy far layers → darker near layers → dark framing silhouettes → dark ground), saves the
// source to design/backdrops/<name>.svg and renders public/img/scenes/<name>.webp with sharp.
//   node tools/backdrops.mjs            all backdrops
//   node tools/backdrops.mjs forest     just one (or several names)
// Scenes are 1920×1080. Road panoramas are 3840×1080 and tile seamlessly (every wave and object wraps).
// Composition rules from the projector: calm middle 60%, detail at the edges and in the sky, dark bottom
// third (road and riders sit over it), quiet top 10% (the chapter line).
import sharp from "sharp";
import { mkdirSync, writeFileSync, statSync } from "node:fs";

const H = 1080;
const SRC = new URL("../design/backdrops/", import.meta.url);
const OUT = new URL("../public/img/scenes/", import.meta.url);

// ------------------------------------------------------------------ small helpers
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
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
const n = (v) => Math.round(v * 10) / 10;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ the canvas: one backdrop being drawn
class Art {
  constructor(w, pal, seed) {
    Object.assign(this, { w, pal, r: rng(seed), defs: [], out: [], ids: 0 });
    this.periodic = w > 1920; // panoramas wrap
  }
  id(p) { return `${p}${++this.ids}`; }
  add(...s) { this.out.push(...s); }
  /** A depth tint: 0 = far (hazy, near the horizon colour), 1 = nearest silhouette. */
  depth(t) { return mix(mix(this.pal.horizon, this.pal.mid, 0.35), this.pal.dark, t); }
  /** Draw something at x, and again one width over if it crosses a panorama's seam. */
  wrap(x, size, fn) {
    this.add(fn(x));
    if (!this.periodic) return;
    if (x < size) this.add(fn(x + this.w));
    if (x > this.w - size) this.add(fn(x - this.w));
  }

  sky() {
    const p = this.pal;
    this.defs.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset=".42" stop-color="${p.mid}"/><stop offset=".6" stop-color="${p.horizon}"/><stop offset="1" stop-color="${p.horizon}"/></linearGradient>`);
    this.add(`<rect width="${this.w}" height="${H}" fill="url(#sky)"/>`);
  }
  glow(x, y, r, color = this.pal.glow, a = 0.85) {
    const id = this.id("g");
    this.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/><stop offset=".45" stop-color="${color}" stop-opacity="${a * 0.35}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
    this.add(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r)}" ry="${n(r * 0.62)}" fill="url(#${id})"/>`);
  }
  stars(count, yMax = 430) {
    for (let i = 0; i < count; i++) {
      const x = this.r() * this.w;
      const y = 70 + this.r() ** 1.4 * (yMax - 70);
      this.wrap(x, 4, (xx) => `<circle cx="${n(xx)}" cy="${n(y)}" r="${n(0.8 + this.r() * 1.6)}" fill="#fff7e6" opacity="${n(0.25 + this.r() * 0.55)}"/>`);
    }
  }
  moon(x, y, r, color = "#fff1d0") {
    const id = this.id("m");
    this.defs.push(`<mask id="${id}"><rect width="${this.w}" height="${H}" fill="#000"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x + r * 0.42}" cy="${y - r * 0.18}" r="${r * 0.92}" fill="#000"/></mask>`);
    this.glow(x, y, r * 5, color, 0.22);
    this.add(`<rect width="${this.w}" height="${H}" fill="${color}" mask="url(#${id})"/>`);
  }
  clouds(count, y0, y1, color, a = 0.28) {
    for (let i = 0; i < count; i++) {
      const x = this.r() * this.w, y = y0 + this.r() * (y1 - y0), s = 90 + this.r() * 160;
      this.wrap(x, s * 1.2, (xx) => `<g fill="${color}" opacity="${n(a * (0.6 + this.r() * 0.6))}"><ellipse cx="${n(xx)}" cy="${n(y)}" rx="${n(s)}" ry="${n(s * 0.13)}"/><ellipse cx="${n(xx - s * 0.25)}" cy="${n(y - s * 0.09)}" rx="${n(s * 0.45)}" ry="${n(s * 0.12)}"/><ellipse cx="${n(xx + s * 0.3)}" cy="${n(y - s * 0.06)}" rx="${n(s * 0.38)}" ry="${n(s * 0.1)}"/></g>`);
    }
  }
  /** A hill line: integer waves, so a panorama's line meets itself at the seam. shape(x) scales the height. */
  ridge({ base, amp, waves = [[1, 0.45], [2, 0.3], [4, 0.18], [9, 0.1], [21, 0.05], [43, 0.025]], shape = () => 1, fill, rough = 1 }) {
    const ph = waves.map(() => this.r() * Math.PI * 2);
    const per = this.w / 1920; // keep wave widths the same on panoramas
    const y = (x) => base - amp * shape(x) * waves.reduce((s, [k, a], i) => s + a * (i > 2 ? rough : 1) * (0.5 + 0.5 * Math.sin((2 * Math.PI * Math.round(k * per) * x) / this.w + ph[i])), 0);
    if (fill) this.area(y, fill);
    return y;
  }
  area(y, fill, step = 6) {
    let d = `M0 ${H} L0 ${n(y(0))}`;
    for (let x = step; x <= this.w; x += step) d += ` L${x} ${n(y(x))}`;
    this.add(`<path d="${d} L${this.w} ${H} Z" fill="${fill}"/>`);
  }
  /** A soft band of mist along the horizon. */
  mist(y, h, color = this.pal.horizon, a = 0.35) {
    const id = this.id("mi");
    this.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset=".5" stop-color="${color}" stop-opacity="${a}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`);
    this.add(`<rect x="0" y="${y - h / 2}" width="${this.w}" height="${h}" fill="url(#${id})"/>`);
  }
  /** The dark ground for the bottom third (the road and riders sit over it). */
  ground(from = 700, to = 840) {
    const id = this.id("gr");
    this.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${this.pal.dark}" stop-opacity="0"/><stop offset="${n((to - from) / (H - from))}" stop-color="${this.pal.dark}" stop-opacity="1"/><stop offset="1" stop-color="${this.pal.dark}"/></linearGradient>`);
    this.add(`<rect x="0" y="${from}" width="${this.w}" height="${H - from}" fill="url(#${id})"/>`);
  }
  /** Objects along a hill line: evenly spaced with jitter, wrapping on panoramas. */
  row(y, { from = 0, to = this.w, count, size: [a, b], draw, keep = () => true }) {
    const step = (to - from) / count;
    for (let i = 0; i < count; i++) {
      const x = from + step * (i + 0.5) + (this.r() - 0.5) * step * 0.8;
      if (!keep(x)) continue;
      const s = a + this.r() * (b - a);
      const seed = this.r();
      this.wrap(x, s, (xx) => draw(xx, y(x) + 4, s, seed));
    }
  }
  svg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${H}" viewBox="0 0 ${this.w} ${H}"><defs>${this.defs.join("")}</defs>${this.out.join("")}</svg>`;
  }
}

// ------------------------------------------------------------------ shapes (all flat silhouettes; base at x,y; s = height)
const roundTree = (x, y, s, f) => `<g fill="${f}"><rect x="${n(x - s * 0.035)}" y="${n(y - s * 0.5)}" width="${n(s * 0.07)}" height="${n(s * 0.5)}"/><circle cx="${n(x)}" cy="${n(y - s * 0.66)}" r="${n(s * 0.28)}"/><circle cx="${n(x - s * 0.2)}" cy="${n(y - s * 0.52)}" r="${n(s * 0.2)}"/><circle cx="${n(x + s * 0.21)}" cy="${n(y - s * 0.54)}" r="${n(s * 0.2)}"/></g>`;
const orchardTree = (x, y, s, f, fruit) => roundTree(x, y, s, f) + [[-0.12, -0.6], [0.1, -0.7], [0.18, -0.5], [-0.2, -0.45], [0.02, -0.52]].map(([dx, dy]) => `<circle cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" r="${n(s * 0.035)}" fill="${fruit}"/>`).join("");
const rainTree = (x, y, s, f) => `<g fill="${f}"><path d="M${n(x - s * 0.05)} ${y} L${n(x - s * 0.035)} ${n(y - s * 0.36)} L${n(x - s * 0.28)} ${n(y - s * 0.64)} L${n(x - s * 0.24)} ${n(y - s * 0.67)} L${n(x)} ${n(y - s * 0.44)} L${n(x + s * 0.24)} ${n(y - s * 0.69)} L${n(x + s * 0.29)} ${n(y - s * 0.66)} L${n(x + s * 0.04)} ${n(y - s * 0.36)} L${n(x + s * 0.06)} ${y} Z"/>
  <ellipse cx="${n(x)}" cy="${n(y - s * 0.74)}" rx="${n(s * 0.62)}" ry="${n(s * 0.15)}"/><ellipse cx="${n(x - s * 0.38)}" cy="${n(y - s * 0.7)}" rx="${n(s * 0.33)}" ry="${n(s * 0.12)}"/><ellipse cx="${n(x + s * 0.4)}" cy="${n(y - s * 0.71)}" rx="${n(s * 0.34)}" ry="${n(s * 0.12)}"/><ellipse cx="${n(x - s * 0.1)}" cy="${n(y - s * 0.85)}" rx="${n(s * 0.42)}" ry="${n(s * 0.12)}"/><ellipse cx="${n(x + s * 0.17)}" cy="${n(y - s * 0.83)}" rx="${n(s * 0.36)}" ry="${n(s * 0.11)}"/></g>`;
const teak = (x, y, s, f, seed = 0.5) => {
  const leaves = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + seed * 3;
    const lx = x + Math.cos(a) * s * 0.2, ly = y - s * 0.8 + Math.sin(a) * s * 0.13;
    leaves.push(`<ellipse cx="${n(lx)}" cy="${n(ly)}" rx="${n(s * 0.12)}" ry="${n(s * 0.065)}" transform="rotate(${n((a * 180) / Math.PI)} ${n(lx)} ${n(ly)})"/>`);
  }
  return `<g fill="${f}"><rect x="${n(x - s * 0.022)}" y="${n(y - s * 0.82)}" width="${n(s * 0.044)}" height="${n(s * 0.82)}"/><path d="M${n(x)} ${n(y - s * 0.55)} L${n(x - s * 0.16)} ${n(y - s * 0.7)} L${n(x - s * 0.15)} ${n(y - s * 0.72)} L${n(x + s * 0.01)} ${n(y - s * 0.6)} Z"/><ellipse cx="${n(x)}" cy="${n(y - s * 0.84)}" rx="${n(s * 0.2)}" ry="${n(s * 0.12)}"/>${leaves.join("")}</g>`;
};
const palm = (x, y, s, f) => {
  const tx = x + s * 0.12, ty = y - s;
  const fronds = [-150, -120, -95, -70, -40, -15, 10].map((a) => { const r = (a * Math.PI) / 180; return `<path d="M${n(tx)} ${n(ty)} Q${n(tx + Math.cos(r) * s * 0.2)} ${n(ty + Math.sin(r) * s * 0.25 - s * 0.06)} ${n(tx + Math.cos(r) * s * 0.36)} ${n(ty + Math.sin(r) * s * 0.2 + s * 0.12)}"/>`; }).join("");
  return `<g stroke="${f}" fill="none" stroke-linecap="round"><path d="M${n(x)} ${y} Q${n(x + s * 0.02)} ${n(y - s * 0.6)} ${n(tx)} ${n(ty)}" stroke-width="${n(s * 0.045)}"/><g stroke-width="${n(s * 0.035)}">${fronds}</g></g>`;
};
const banyan = (x, y, s, f, seed = 0.4) => {
  const roots = [];
  for (let i = 0; i < 26; i++) { const rx = x - s * 0.75 + (i / 25) * s * 1.5 + Math.sin(i * 7 + seed * 9) * 8; roots.push(`<path d="M${n(rx)} ${n(y - s * 0.62)} L${n(rx + Math.sin(i) * 6)} ${n(y - (i % 3) * s * 0.06)}" stroke-width="${n(1.5 + (i % 4))}"/>`); }
  return `<g fill="${f}"><path d="M${n(x - s * 0.12)} ${y} Q${n(x - s * 0.06)} ${n(y - s * 0.4)} ${n(x - s * 0.3)} ${n(y - s * 0.7)} L${n(x + s * 0.3)} ${n(y - s * 0.7)} Q${n(x + s * 0.06)} ${n(y - s * 0.4)} ${n(x + s * 0.14)} ${y} Z"/>
    <ellipse cx="${n(x)}" cy="${n(y - s * 0.78)}" rx="${n(s * 0.85)}" ry="${n(s * 0.2)}"/><ellipse cx="${n(x - s * 0.4)}" cy="${n(y - s * 0.9)}" rx="${n(s * 0.5)}" ry="${n(s * 0.18)}"/><ellipse cx="${n(x + s * 0.35)}" cy="${n(y - s * 0.92)}" rx="${n(s * 0.55)}" ry="${n(s * 0.17)}"/><ellipse cx="${n(x)}" cy="${n(y - s * 1.02)}" rx="${n(s * 0.5)}" ry="${n(s * 0.15)}"/>
    <g stroke="${f}" fill="none">${roots.join("")}</g></g>`;
};
const acacia = (x, y, s, f) => `<g fill="${f}"><path d="M${n(x - s * 0.03)} ${y} L${n(x - s * 0.02)} ${n(y - s * 0.45)} L${n(x - s * 0.2)} ${n(y - s * 0.72)} L${n(x - s * 0.17)} ${n(y - s * 0.74)} L${n(x + s * 0.01)} ${n(y - s * 0.52)} L${n(x + s * 0.17)} ${n(y - s * 0.76)} L${n(x + s * 0.2)} ${n(y - s * 0.74)} L${n(x + s * 0.04)} ${n(y - s * 0.45)} L${n(x + s * 0.04)} ${y} Z"/><ellipse cx="${n(x)}" cy="${n(y - s * 0.8)}" rx="${n(s * 0.48)}" ry="${n(s * 0.08)}"/><ellipse cx="${n(x - s * 0.15)}" cy="${n(y - s * 0.86)}" rx="${n(s * 0.28)}" ry="${n(s * 0.06)}"/><ellipse cx="${n(x + s * 0.18)}" cy="${n(y - s * 0.85)}" rx="${n(s * 0.25)}" ry="${n(s * 0.06)}"/></g>`;
const bush = (x, y, s, f) => `<g fill="${f}"><ellipse cx="${n(x)}" cy="${n(y - s * 0.35)}" rx="${n(s * 0.5)}" ry="${n(s * 0.38)}"/><ellipse cx="${n(x - s * 0.4)}" cy="${n(y - s * 0.2)}" rx="${n(s * 0.35)}" ry="${n(s * 0.25)}"/><ellipse cx="${n(x + s * 0.42)}" cy="${n(y - s * 0.22)}" rx="${n(s * 0.32)}" ry="${n(s * 0.24)}"/></g>`;
const tallTree = (x, y, s, f) => `<g fill="${f}"><rect x="${n(x - s * 0.025)}" y="${n(y - s * 0.3)}" width="${n(s * 0.05)}" height="${n(s * 0.3)}"/><ellipse cx="${n(x)}" cy="${n(y - s * 0.62)}" rx="${n(s * 0.17)}" ry="${n(s * 0.4)}"/></g>`;
/** A granite tor of the Deccan: rounded boulders stacked, with a faint rim of light on top. */
const tor = (x, y, s, f, rim) => {
  const b = [[0, -0.22, 0.62, 0.26], [-0.25, -0.52, 0.34, 0.22], [0.2, -0.5, 0.3, 0.2], [-0.04, -0.78, 0.22, 0.16], [0.42, -0.18, 0.3, 0.18]];
  return `<g>${b.map(([dx, dy, rx, ry]) => `<ellipse cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" rx="${n(rx * s)}" ry="${n(ry * s)}" fill="${f}"/>`).join("")}${rim ? b.map(([dx, dy, rx, ry]) => `<path d="M${n(x + (dx - rx * 0.7) * s)} ${n(y + (dy - ry * 0.55) * s)} Q${n(x + dx * s)} ${n(y + (dy - ry * 1.05) * s)} ${n(x + (dx + rx * 0.5) * s)} ${n(y + (dy - ry * 0.75) * s)}" stroke="${rim}" stroke-width="2" fill="none" opacity=".35"/>`).join("") : ""}</g>`;
};
const house = (x, y, w, h, wall, roof, lit) => `<g><rect x="${n(x)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" fill="${wall}"/><path d="M${n(x - w * 0.1)} ${n(y - h)} L${n(x + w * 0.2)} ${n(y - h - h * 0.55)} L${n(x + w * 0.8)} ${n(y - h - h * 0.55)} L${n(x + w * 1.1)} ${n(y - h)} Z" fill="${roof}"/>${lit ? `<rect x="${n(x + w * 0.58)}" y="${n(y - h * 0.68)}" width="${n(w * 0.18)}" height="${n(h * 0.3)}" fill="${lit}"/>` : ""}</g>`;
const person = (x, y, s, f) => `<g fill="${f}"><circle cx="${n(x)}" cy="${n(y - s * 0.86)}" r="${n(s * 0.12)}"/><rect x="${n(x - s * 0.13)}" y="${n(y - s * 0.72)}" width="${n(s * 0.26)}" height="${n(s * 0.72)}" rx="${n(s * 0.1)}"/></g>`;
const birds = (x, y, s, c) => `<path d="M${n(x)} ${n(y)} q${n(s * 0.5)} ${n(-s * 0.45)} ${n(s)} 0 q${n(s * 0.5)} ${n(-s * 0.45)} ${n(s)} 0" stroke="${c}" stroke-width="2" fill="none"/>`;
const lamppost = (x, y, s, f, light) => `<g><rect x="${n(x - s * 0.015)}" y="${n(y - s)}" width="${n(s * 0.03)}" height="${n(s)}" fill="${f}"/><rect x="${n(x - s * 0.05)}" y="${n(y - s * 0.06)}" width="${n(s * 0.1)}" height="${n(s * 0.06)}" fill="${f}"/><path d="M${n(x - s * 0.06)} ${n(y - s * 1.02)} L${n(x + s * 0.06)} ${n(y - s * 1.02)} L${n(x + s * 0.045)} ${n(y - s * 1.14)} L${n(x - s * 0.045)} ${n(y - s * 1.14)} Z" fill="${light}"/><path d="M${n(x - s * 0.07)} ${n(y - s * 1.14)} L${n(x + s * 0.07)} ${n(y - s * 1.14)} L${n(x)} ${n(y - s * 1.22)} Z" fill="${f}"/></g>`;
const paw = (x, y, s, c) => `<g fill="${c}" opacity=".22"><ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(s * 0.5)}" ry="${n(s * 0.4)}"/>${[[-0.55, -0.55], [-0.2, -0.8], [0.2, -0.8], [0.55, -0.55]].map(([dx, dy]) => `<ellipse cx="${n(x + dx * s)}" cy="${n(y + dy * s)}" rx="${n(s * 0.17)}" ry="${n(s * 0.2)}"/>`).join("")}</g>`;
/** A string of festival pennants between two points, sagging a little. */
const bunting = (x1, y1, x2, y2, colors) => {
  const out = [`<path d="M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.max(y1, y2) + 24} ${x2} ${y2}" stroke="#1a1414" stroke-width="1.5" fill="none"/>`];
  for (let i = 1; i < 12; i++) {
    const t = i / 12, x = x1 + (x2 - x1) * t, y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * (Math.max(y1, y2) + 24) + t * t * y2;
    out.push(`<path d="M${n(x - 6)} ${n(y)} L${n(x + 6)} ${n(y)} L${n(x)} ${n(y + 15)} Z" fill="${colors[i % colors.length]}"/>`);
  }
  return out.join("");
};
const edge = (w) => (x) => Math.abs(x / w - 0.5) * 2; // 0 in the middle, 1 at the edges

// ------------------------------------------------------------------ an exterior view (used through the two windows)
function windowView(a, x, y, w, h, draw) {
  const id = a.id("win");
  a.defs.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);
  a.add(`<g clip-path="url(#${id})">`);
  draw();
  a.add(`</g>`);
}

// ------------------------------------------------------------------ the scenes
const S = {};

S.prologue = () => {
  const a = new Art(1920, { top: "#0a2730", mid: "#1d5958", horizon: "#e79a4c", glow: "#ffc970", dark: "#060f0f" }, 11);
  a.sky();
  a.glow(960, 600, 760);
  a.stars(70, 330);
  a.moon(1500, 190, 26);
  a.clouds(6, 250, 420, mix(a.pal.horizon, a.pal.mid, 0.4));
  // Bengaluru's skyline and its glow on the horizon, where the highway leaves the city
  a.glow(960, 610, 520, "#ffb35c", 0.6);
  const sky = [];
  for (let x = 640; x < 1290;) {
    const w = 14 + a.r() * 30, mid = 1 - Math.abs(x - 965) / 340; // taller towers toward the centre, low at the ends
    const h = 18 + a.r() * 40 + Math.max(0, mid) * (40 + a.r() * 80);
    sky.push(`<rect x="${n(x)}" y="${n(604 - h)}" width="${n(w)}" height="${n(h)}" fill="${a.depth(0.35)}"/>`);
    for (let k = 0; k < h / 16; k++) if (a.r() < 0.35) sky.push(`<rect x="${n(x + 3 + a.r() * (w - 8))}" y="${n(604 - h + 8 + k * 14)}" width="3" height="4" fill="#ffd88f" opacity=".7"/>`);
    x += w + 2 + (a.r() < 0.25 ? 10 + a.r() * 20 : 0);
  }
  a.add(...sky);
  const far = a.ridge({ base: 610, amp: 90, shape: (x) => 0.25 + 0.75 * edge(1920)(x), fill: a.depth(0.3) });
  a.row(far, { count: 9, size: [40, 70], draw: (x, y, s) => tor(x, y, s, a.depth(0.3)), keep: (x) => x < 520 || x > 1400 });
  a.mist(610, 120);
  const mid = a.ridge({ base: 660, amp: 120, shape: (x) => 0.1 + 0.9 * edge(1920)(x), fill: a.depth(0.55) });
  a.row(mid, { count: 14, size: [60, 110], draw: (x, y, s) => rainTree(x, y, s, a.depth(0.55)), keep: (x) => x < 560 || x > 1360 });
  // NH44: the highway running north out of the city, toward the vanishing point
  a.add(`<path d="M960 606 L1000 606 L1420 1080 L500 1080 Z" fill="${a.depth(0.82)}"/>`);
  a.add(`<path d="M972 606 L640 1080 M988 606 L1300 1080" stroke="#f3b866" stroke-width="2" opacity=".35"/>`);
  a.add(`<path d="M980 610 L960 1080" stroke="#ffe0a0" stroke-width="3" stroke-dasharray="14 22" opacity=".3"/>`);
  for (const [x, y, s] of [[905, 640, 40], [860, 700, 70], [800, 790, 110], [1060, 640, 40], [1110, 700, 70], [1180, 790, 110]]) a.add(lamppost(x, y, s, a.depth(0.85), "#ffd27a"));
  a.ridge({ base: 760, amp: 160, shape: (x) => Math.max(0, edge(1920)(x) - 0.45) * 1.8, fill: a.depth(0.85) });
  // Framing: rain trees and granite boulders of the Deccan plateau
  a.add(tor(150, 780, 260, a.depth(0.95), "#ffcf86"), tor(1790, 790, 240, a.depth(0.95), "#ffcf86"));
  a.add(rainTree(120, 760, 620, a.pal.dark), rainTree(1830, 770, 600, a.pal.dark));
  a.ground(720, 860);
  return a;
};

S.workbench = () => {
  const p = { top: "#0f3a3c", mid: "#3d8a84", horizon: "#f5c99a", glow: "#fff0c8", dark: "#061312" };
  const a = new Art(1920, p, 22);
  const wall = "#0b1c1c";
  a.add(`<rect width="1920" height="1080" fill="${wall}"/>`);
  // The open shutter: a calm Bengaluru street at dawn, rain trees in soft light
  const W = { x: 470, y: 190, w: 980, h: 520 };
  windowView(a, W.x, W.y, W.w, W.h, () => {
    a.sky();
    a.glow(980, 520, 620, p.glow, 0.9);
    a.clouds(5, 260, 380, "#ffffff", 0.18);
    const far = a.ridge({ base: 610, amp: 50, fill: a.depth(0.15) });
    a.row(far, { from: 470, to: 1450, count: 12, size: [40, 60], draw: (x, y, s) => `<rect x="${x - s * 0.3}" y="${y - s}" width="${s * 0.6}" height="${s}" fill="${a.depth(0.18)}"/>` });
    a.mist(620, 90, "#fff3dc", 0.4);
    a.add(`<rect x="470" y="640" width="980" height="80" fill="${a.depth(0.35)}"/>`);
    a.row(() => 660, { from: 470, to: 1450, count: 5, size: [190, 250], draw: (x, y, s) => rainTree(x, y, s, a.depth(0.42)) });
    a.add(`<rect x="470" y="680" width="980" height="40" fill="${a.depth(0.5)}"/>`);
  });
  // Shutter rolled up, frame and light falling into the room
  a.add(`<rect x="${W.x - 20}" y="${W.y - 70}" width="${W.w + 40}" height="70" fill="#132a29"/>`);
  for (let y = W.y - 62; y < W.y; y += 12) a.add(`<rect x="${W.x - 20}" y="${y}" width="${W.w + 40}" height="3" fill="#1c3a38"/>`);
  a.add(`<rect x="${W.x - 20}" y="${W.y}" width="20" height="${W.h}" fill="#132a29"/><rect x="${W.x + W.w}" y="${W.y}" width="20" height="${W.h}" fill="#132a29"/>`);
  a.add(`<path d="M${W.x} ${W.y + W.h} L${W.x + W.w} ${W.y + W.h} L${W.x + W.w + 260} 1080 L${W.x - 260} 1080 Z" fill="#ffe7c2" opacity=".07"/>`);
  // Left: shelves with tools, boxes, a helmet; cables hanging; a laptop glowing on the bench
  a.add(`<rect x="0" y="80" width="380" height="1000" fill="#081413"/>`);
  for (const y of [260, 430, 600]) a.add(`<rect x="0" y="${y}" width="380" height="10" fill="#183230"/>`);
  for (const [x, y, w, h] of [[30, 200, 90, 60], [140, 215, 70, 45], [230, 190, 110, 70], [40, 370, 120, 60], [200, 385, 80, 45], [60, 545, 70, 55], [160, 560, 150, 40]]) a.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#10231f" stroke="#1d3b37" stroke-width="2"/>`);
  a.add(`<path d="M300 430 a46 46 0 0 1 92 0 Z" fill="#0f2e2b"/><path d="M330 418 h52 v10 h-52 Z" fill="#2dd4bf" opacity=".35"/>`); // helmet
  a.add(`<g stroke="#0e1f1d" stroke-width="5" fill="none"><path d="M420 80 C430 180 380 220 440 330"/><path d="M470 80 C470 150 520 170 505 260"/></g>`);
  a.add(`<rect x="0" y="720" width="560" height="18" fill="#132826"/><rect x="40" y="738" width="16" height="342" fill="#0c1a19"/><rect x="480" y="738" width="16" height="342" fill="#0c1a19"/>`);
  a.glow(250, 650, 260, "#2dd4bf", 0.35);
  a.add(`<path d="M190 718 L210 628 L330 628 L320 718 Z" fill="#0d2422"/><path d="M200 708 L216 638 L322 638 L312 708 Z" fill="#2dd4bf" opacity=".55"/><rect x="170" y="716" width="180" height="6" fill="#16302d"/>`);
  // Right: a pegboard of tools and the motorcycle in silhouette
  a.add(`<rect x="1540" y="120" width="380" height="960" fill="#081413"/>`);
  for (let x = 1570; x < 1900; x += 26) for (let y = 160; y < 520; y += 26) a.add(`<circle cx="${x}" cy="${y}" r="2" fill="#16302d"/>`);
  a.add(`<g fill="#14302d"><rect x="1600" y="200" width="10" height="120"/><circle cx="1605" cy="200" r="18"/><rect x="1680" y="190" width="70" height="18"/><rect x="1708" y="190" width="14" height="110"/><path d="M1800 200 l40 0 l-8 140 l-24 0 Z"/></g>`);
  a.add(`<g transform="translate(1440 760) scale(2.4)" fill="#050d0c" stroke="#2dd4bf" stroke-opacity=".35" stroke-width="1.2"><circle cx="52" cy="96" r="26"/><circle cx="168" cy="96" r="26"/><path d="M24 94h48l22-18h40l26 18 -10 6H34Z"/><path d="M86 60c12-12 40-12 50 0l-6 16H86z"/><path d="M142 50l26 46-8 2-24-44z"/><rect x="84" y="68" width="36" height="28" rx="5"/></g>`);
  a.glow(1720, 700, 240, "#2dd4bf", 0.25);
  a.add(`<path d="M1600 760 L1620 690 L1720 690 L1712 760 Z" fill="#0d2422"/><path d="M1609 752 L1626 698 L1714 698 L1706 752 Z" fill="#2dd4bf" opacity=".45"/>`);
  a.ground(740, 880);
  return a;
};

S.forest = () => {
  const a = new Art(1920, { top: "#0b1d17", mid: "#244d38", horizon: "#c6b46c", glow: "#f0dc92", dark: "#050d09" }, 33);
  a.sky();
  a.glow(900, 590, 680);
  a.stars(50, 300);
  a.moon(420, 180, 22);
  a.clouds(5, 260, 400, mix(a.pal.horizon, a.pal.mid, 0.5), 0.22);
  const far = a.ridge({ base: 600, amp: 70, shape: (x) => 0.3 + 0.7 * edge(1920)(x), fill: a.depth(0.25) });
  // Village rooftops far beyond the trees
  for (const [x, w] of [[760, 26], [800, 32], [846, 22], [1060, 30], [1100, 24]]) a.add(house(x, far(x) + 6, w, 14, a.depth(0.32), a.depth(0.38), "#ffd88a"));
  // The forest watchtower on the right horizon
  const tx = 1520, ty = far(1520) + 4;
  a.add(`<g stroke="${a.depth(0.45)}" stroke-width="5" fill="none"><path d="M${tx - 34} ${ty} L${tx - 18} ${ty - 150} M${tx + 34} ${ty} L${tx + 18} ${ty - 150} M${tx - 30} ${ty - 30} L${tx + 22} ${ty - 110} M${tx + 30} ${ty - 30} L${tx - 22} ${ty - 110}"/></g><rect x="${tx - 34}" y="${ty - 190}" width="68" height="44" fill="${a.depth(0.45)}"/><path d="M${tx - 48} ${ty - 188} L${tx} ${ty - 222} L${tx + 48} ${ty - 188} Z" fill="${a.depth(0.45)}"/><rect x="${tx - 10}" y="${ty - 178}" width="20" height="10" fill="#ffd88a" opacity=".8"/>`);
  a.mist(600, 120);
  const mid = a.ridge({ base: 650, amp: 60, waves: [[2, 0.5], [5, 0.3], [13, 0.2]], fill: a.depth(0.5) });
  a.row(mid, { count: 20, size: [150, 230], draw: (x, y, s, sd) => teak(x, y, s, a.depth(0.5), sd), keep: (x) => x < 640 || x > 1300 });
  a.row(mid, { count: 8, size: [60, 90], draw: (x, y, s) => bush(x, y, s, a.depth(0.55)), keep: (x) => x > 620 && x < 1320 });
  // The forest track winding out between the trees
  a.add(`<path d="M940 1080 C900 900 1040 820 980 700 C960 670 1000 650 990 640 L1010 640 C1030 660 1000 690 1030 720 C1110 820 1000 920 1080 1080 Z" fill="${a.depth(0.62)}"/>`);
  a.ridge({ base: 780, amp: 140, shape: (x) => Math.max(0, edge(1920)(x) - 0.4) * 1.7, fill: a.depth(0.8) });
  // Framing teak trunks, broad leaves, and the camera trap strapped to the left trunk
  a.add(teak(150, 900, 900, a.pal.dark, 0.2), teak(1800, 900, 860, a.pal.dark, 0.7));
  a.add(`<rect x="196" y="300" width="60" height="700" fill="${a.pal.dark}"/>`);
  a.add(`<rect x="180" y="548" width="92" height="12" fill="#2a3a22"/><rect x="236" y="520" width="58" height="76" rx="8" fill="#3a4a30"/><circle cx="265" cy="548" r="15" fill="#11180e" stroke="#58704a" stroke-width="3"/><circle cx="282" cy="580" r="4" fill="#ff5a4a"/>`);
  a.ground(740, 880);
  for (const [x, y] of [[860, 960], [900, 1000], [1010, 930], [1050, 975], [1150, 1010]]) a.add(paw(x, y, 16, "#c6b46c"));
  return a;
};

S.village = () => {
  const a = new Art(1920, { top: "#3a2042", mid: "#b85e2a", horizon: "#f6b24a", glow: "#ffd47c", dark: "#120805" }, 44);
  a.sky();
  a.glow(1000, 560, 760);
  a.clouds(7, 220, 420, "#ffd7a0", 0.3);
  for (const [x, y] of [[1240, 250], [1280, 238], [1320, 262], [1380, 230]]) a.add(birds(x, y, 14, "#4a2620"));
  const far = a.ridge({ base: 590, amp: 120, shape: (x) => 0.4 + 0.6 * edge(1920)(x), fill: a.depth(0.3) });
  a.row(far, { count: 10, size: [50, 80], draw: (x, y, s) => palm(x, y, s, a.depth(0.32)), keep: (x) => x < 600 || x > 1250 });
  a.mist(600, 120);
  const mid = a.ridge({ base: 650, amp: 70, fill: a.depth(0.5) });
  a.row(mid, { count: 6, size: [80, 120], draw: (x, y, s) => palm(x, y, s, a.depth(0.5)), keep: (x) => x < 560 || x > 1400 });
  // Tiled-roof houses climbing the slope on the right, windows lit
  const slope = (x) => 700 - Math.max(0, x - 1260) * 0.55;
  a.add(`<path d="M1180 1080 L1180 720 L1260 700 L1920 335 L1920 1080 Z" fill="${a.depth(0.75)}"/>`);
  for (const [x, w, h] of [[1290, 90, 56], [1390, 110, 64], [1520, 100, 60], [1640, 120, 70], [1770, 110, 66], [1440, 90, 50], [1590, 96, 54], [1720, 88, 52]]) {
    const y = slope(x + w / 2) + (x % 3) * 4;
    a.add(house(x, y, w, h, a.depth(0.82), mix(a.depth(0.7), "#7a3020", 0.5), (x % 2 ? "#ffcb72" : null)));
  }
  // The ration shop: lit shutter, a sign; a notice board; tiny figures waiting
  a.add(`<rect x="1250" y="640" width="250" height="140" fill="${a.depth(0.88)}"/><path d="M1236 640 L1514 640 L1490 610 L1260 610 Z" fill="${mix(a.depth(0.8), "#7a3020", 0.4)}"/>`);
  a.glow(1340, 740, 220, "#ffc060", 0.45);
  a.add(`<rect x="1272" y="690" width="140" height="90" fill="#ffc768"/>`);
  for (let y = 696; y < 780; y += 8) a.add(`<rect x="1272" y="${y}" width="140" height="2" fill="#d9903a"/>`);
  a.add(`<rect x="1270" y="652" width="210" height="30" fill="#2b130a"/><text x="1375" y="674" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#ffc768" letter-spacing="2">RATION SHOP</text>`);
  a.add(`<rect x="1110" y="680" width="80" height="56" fill="${a.depth(0.85)}"/><rect x="1118" y="736" width="6" height="44" fill="${a.depth(0.85)}"/><rect x="1176" y="736" width="6" height="44" fill="${a.depth(0.85)}"/><rect x="1122" y="688" width="22" height="18" fill="#f4dfb4" opacity=".5"/><rect x="1150" y="690" width="26" height="22" fill="#f4dfb4" opacity=".4"/>`);
  for (const [x, s] of [[1215, 34], [1236, 30], [1430, 34], [1452, 28], [1530, 32]]) a.add(person(x, 782, s, a.depth(0.92)));
  // The banyan framing the left, aerial roots down to the ground
  a.add(banyan(250, 800, 560, a.pal.dark, 0.3));
  a.add(`<path d="M0 760 Q300 700 700 760 L700 1080 L0 1080 Z" fill="${a.pal.dark}"/>`);
  a.ground(760, 880);
  return a;
};

S.pump = () => {
  const a = new Art(1920, { top: "#1d1631", mid: "#7c3c22", horizon: "#f1a040", glow: "#ffcf72", dark: "#0b0705" }, 55);
  a.sky();
  a.glow(760, 600, 700);
  a.stars(40, 280);
  a.moon(1240, 170, 20);
  a.clouds(6, 240, 420, mix(a.pal.horizon, a.pal.mid, 0.5), 0.25);
  // Vidarbha: wide, flat, a few acacias; the highway curving away into it
  const far = a.ridge({ base: 610, amp: 22, fill: a.depth(0.3) });
  a.row(far, { count: 12, size: [30, 50], draw: (x, y, s) => acacia(x, y, s, a.depth(0.32)) });
  a.mist(610, 110);
  a.ridge({ base: 640, amp: 18, fill: a.depth(0.5) });
  a.add(`<path d="M720 1080 C760 900 900 760 1060 690 C1160 650 1260 632 1360 622 L1390 624 C1300 640 1200 664 1120 700 C980 770 900 900 960 1080 Z" fill="${a.depth(0.75)}"/>`);
  a.add(`<path d="M840 1080 C870 900 980 770 1110 700 C1200 660 1290 640 1375 623" stroke="#ffe0a0" stroke-width="3" stroke-dasharray="16 22" fill="none" opacity=".3"/>`);
  // The petrol pump on the right: canopy lights glowing, two dispensers, a small kiosk, a blank price board
  a.glow(1600, 760, 420, "#ffd27a", 0.55);
  a.add(`<rect x="1830" y="420" width="10" height="320" fill="${a.depth(0.85)}"/><rect x="1790" y="380" width="90" height="120" rx="6" fill="${a.depth(0.85)}"/><rect x="1800" y="392" width="70" height="96" rx="3" fill="#ffcf72" opacity=".55"/>`);
  a.add(`<rect x="1380" y="560" width="440" height="34" fill="${a.depth(0.9)}"/><rect x="1380" y="594" width="440" height="8" fill="#fff1c8"/><rect x="1410" y="602" width="14" height="180" fill="${a.depth(0.9)}"/><rect x="1776" y="602" width="14" height="180" fill="${a.depth(0.9)}"/>`);
  a.add(`<path d="M1390 602 L1810 602 L1880 790 L1320 790 Z" fill="#ffe7b0" opacity=".1"/>`);
  for (const x of [1520, 1660]) a.add(`<rect x="${x}" y="690" width="56" height="96" rx="6" fill="${a.depth(0.92)}"/><rect x="${x + 10}" y="702" width="36" height="22" fill="#ffd27a" opacity=".75"/><path d="M${x + 56} 720 q24 6 14 46" stroke="${a.depth(0.92)}" stroke-width="5" fill="none"/>`);
  a.add(`<rect x="1250" y="690" width="120" height="96" fill="${a.depth(0.9)}"/><rect x="1268" y="712" width="40" height="30" fill="#ffcf72" opacity=".7"/>`);
  // Framing: an acacia and scrub on the left
  a.add(acacia(170, 820, 520, a.pal.dark), bush(420, 820, 120, a.pal.dark), bush(40, 840, 160, a.pal.dark));
  a.ground(770, 880);
  return a;
};

S.records = () => {
  const p = { top: "#0b0b26", mid: "#23265e", horizon: "#4b4a8c", glow: "#b6b4ff", dark: "#05050f" };
  const a = new Art(1920, p, 66);
  a.add(`<rect width="1920" height="1080" fill="#0c0d20"/>`);
  // The window: Nagpur at night, the lit Zero Mile pillar on the horizon, stars and a moon
  const W = { x: 520, y: 170, w: 880, h: 500 };
  windowView(a, W.x, W.y, W.w, W.h, () => {
    a.sky();
    a.stars(90, 560);
    a.moon(700, 270, 34);
    const city = [];
    for (let x = 520; x < 1400; x += 22) { const h = 26 + Math.abs(Math.sin(x * 0.05) * Math.cos(x * 0.013)) * 90; city.push(`<rect x="${x}" y="${640 - h}" width="19" height="${h}" fill="${a.depth(0.4)}"/>`); for (let k = 0; k < h / 20; k++) if ((x + k * 7) % 5 === 0) city.push(`<rect x="${x + 6}" y="${640 - h + 8 + k * 18}" width="4" height="5" fill="#ffd38a" opacity=".7"/>`); }
    a.add(...city);
    // The Zero Mile pillar: a lit sandstone column on its plinth, four small horses at its foot
    a.glow(1140, 520, 260, "#ffe2a8", 0.5);
    a.add(`<rect x="1092" y="608" width="96" height="20" fill="#c9b08a"/><rect x="1110" y="590" width="60" height="20" fill="#e2c99c"/><path d="M1124 590 L1130 420 L1150 420 L1156 590 Z" fill="#f2deb4"/><rect x="1124" y="410" width="32" height="12" fill="#e2c99c"/><path d="M1130 410 L1140 390 L1150 410 Z" fill="#e2c99c"/>`);
    for (const x of [1098, 1118, 1160, 1180]) a.add(`<path d="M${x - 9} 608 l2 -12 l10 -2 l4 -6 l3 6 l-3 14 Z" fill="#a8906c"/>`);
    a.add(`<rect x="520" y="638" width="880" height="40" fill="${a.depth(0.6)}"/>`);
  });
  a.add(`<g fill="#1a1c38"><rect x="${W.x - 16}" y="${W.y - 16}" width="${W.w + 32}" height="16"/><rect x="${W.x - 16}" y="${W.y + W.h}" width="${W.w + 32}" height="22"/><rect x="${W.x - 16}" y="${W.y}" width="16" height="${W.h}"/><rect x="${W.x + W.w}" y="${W.y}" width="16" height="${W.h}"/><rect x="${W.x + W.w / 2 - 6}" y="${W.y}" width="12" height="${W.h}"/><rect x="${W.x}" y="${W.y + W.h * 0.45}" width="${W.w}" height="10"/></g>`);
  a.add(`<path d="M${W.x} ${W.y + W.h} L${W.x + W.w} ${W.y + W.h} L${W.x + W.w + 200} 1080 L${W.x - 200} 1080 Z" fill="#8f8cff" opacity=".05"/>`);
  // Shelves of files on both sides
  const shelf = (x0, x1, seed) => {
    const r = rng(seed);
    const out = [`<rect x="${x0}" y="60" width="${x1 - x0}" height="1020" fill="#090a1a"/>`];
    for (const y of [250, 430, 610, 790]) {
      out.push(`<rect x="${x0}" y="${y}" width="${x1 - x0}" height="10" fill="#1b1d3c"/>`);
      for (let x = x0 + 14; x < x1 - 20;) { const w = 14 + r() * 22, h = 90 + r() * 70; const c = ["#1d2050", "#262a62", "#30285a", "#1a2a4a"][Math.floor(r() * 4)]; out.push(`<rect x="${n(x)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" fill="${c}"/><rect x="${n(x + 3)}" y="${n(y - h + 14)}" width="${n(w - 6)}" height="8" fill="#c8c6f0" opacity=".18"/>`); x += w + 3 + (r() < 0.1 ? 30 : 0); }
    }
    return out.join("");
  };
  a.add(shelf(0, 400, 7), shelf(1520, 1920, 8));
  // A padlocked cabinet on the left
  a.add(`<rect x="300" y="640" width="250" height="440" fill="#13163a"/>${[690, 800, 910].map((y) => `<rect x="316" y="${y}" width="218" height="96" fill="#191d48"/><rect x="405" y="${y + 40}" width="40" height="8" fill="#3a3f7a"/>`).join("")}<path d="M412 600 a18 18 0 0 1 36 0 v20 h-8 v-20 a10 10 0 0 0 -20 0 v20 h-8 Z" fill="#818cf8"/><rect x="404" y="618" width="52" height="40" rx="6" fill="#818cf8"/><circle cx="430" cy="636" r="5" fill="#13163a"/>`);
  // A desk with a lamp's warm pool on the right, files stacked
  a.glow(1500, 760, 330, "#ffcf86", 0.5);
  a.add(`<rect x="1300" y="770" width="620" height="18" fill="#191b3a"/><rect x="1340" y="788" width="16" height="292" fill="#0e1028"/>`);
  a.add(`<path d="M1430 770 L1460 650 L1540 610" stroke="#2a2d5a" stroke-width="8" fill="none"/><path d="M1510 588 L1590 600 L1570 640 L1500 620 Z" fill="#2a2d5a"/><path d="M1520 632 L1570 640 L1660 770 L1420 770 Z" fill="#ffd590" opacity=".22"/><rect x="1400" y="762" width="70" height="10" fill="#2a2d5a"/>`);
  for (const [y, w] of [[744, 150], [726, 140], [708, 156]]) a.add(`<rect x="1620" y="${y}" width="${w}" height="18" fill="#e8dcc0" opacity=".55"/>`);
  a.ground(780, 900);
  return a;
};

S.bridge = () => {
  const a = new Art(1920, { top: "#2a1420", mid: "#9a4428", horizon: "#f08a52", glow: "#ffc388", dark: "#100706" }, 77);
  a.sky();
  a.glow(1000, 570, 760);
  a.stars(30, 260);
  a.moon(1380, 200, 18);
  a.clouds(6, 230, 400, "#ffb48a", 0.25);
  // Bundelkhand: rugged hills, Jhansi Fort on a far hilltop
  const far = a.ridge({ base: 560, amp: 150, waves: [[1, 0.4], [3, 0.3], [6, 0.2], [14, 0.12], [31, 0.06]], shape: (x) => 0.35 + 0.65 * edge(1920)(x), fill: a.depth(0.3) });
  const fx = 470, fy = far(fx) + 10;
  const fort = [`<path d="M${fx - 120} ${fy} L${fx - 110} ${fy - 60} L${fx + 120} ${fy - 60} L${fx + 130} ${fy} Z"/>`];
  for (const bx of [-110, -40, 40, 110]) fort.push(`<rect x="${fx + bx - 18}" y="${fy - 90}" width="36" height="40"/>`);
  for (let cx = fx - 110; cx < fx + 120; cx += 14) fort.push(`<rect x="${cx}" y="${fy - 70}" width="8" height="12"/>`);
  fort.push(`<rect x="${fx - 12}" y="${fy - 130}" width="24" height="50"/><path d="M${fx - 18} ${fy - 130} L${fx} ${fy - 150} L${fx + 18} ${fy - 130} Z"/>`);
  a.add(`<g fill="${a.depth(0.5)}">${fort.join("")}</g>`);
  for (const wx of [-80, -20, 30, 90]) a.add(`<rect x="${fx + wx}" y="${fy - 40}" width="5" height="8" fill="#ffc27a" opacity=".75"/>`);
  a.mist(590, 120);
  const mid = a.ridge({ base: 630, amp: 130, waves: [[2, 0.5], [5, 0.3], [11, 0.2], [25, 0.1]], shape: (x) => 0.15 + 0.85 * edge(1920)(x), fill: a.depth(0.55) });
  a.row(mid, { count: 10, size: [40, 70], draw: (x, y, s) => bush(x, y, s, a.depth(0.58)), keep: (x) => x < 560 || x > 1360 });
  // The river and its light
  a.add(`<rect x="0" y="640" width="1920" height="150" fill="${mix(a.pal.horizon, a.pal.dark, 0.45)}"/>`);
  for (const [x, y, w] of [[860, 660, 220], [980, 690, 160], [760, 720, 200], [1100, 740, 140], [900, 770, 120]]) a.add(`<rect x="${x}" y="${y}" width="${w}" height="3" fill="#ffc388" opacity=".35"/>`);
  // The footbridge, broken in the middle: two halves hang toward the water
  const half = (x0, x1, dir) => {
    const out = [`<path d="M${x0} 600 Q${(x0 + x1) / 2} ${640} ${x1} ${700}" stroke="#2a1410" stroke-width="3" fill="none"/>`, `<path d="M${x0} 614 Q${(x0 + x1) / 2} ${656} ${x1} ${716}" stroke="#2a1410" stroke-width="3" fill="none"/>`];
    for (let i = 0; i <= 10; i++) { const t = i / 10, x = x0 + (x1 - x0) * t, y = (1 - t) ** 2 * 607 + 2 * (1 - t) * t * 648 + t * t * 708; out.push(`<rect x="${n(x - 3)}" y="${n(y - 2)}" width="10" height="16" fill="#3a1d14" transform="rotate(${dir * 12 * t} ${n(x)} ${n(y)})"/>`); }
    return out.join("");
  };
  a.add(`<rect x="560" y="560" width="10" height="70" fill="#2a1410"/><rect x="1350" y="560" width="10" height="70" fill="#2a1410"/>`, half(565, 880, 1), half(1355, 1040, -1));
  // The farmers' cooperative shed with its satellite dish, on the right bank
  a.add(`<rect x="1500" y="560" width="170" height="80" fill="${a.depth(0.78)}"/><path d="M1488 562 L1682 540 L1690 560 L1492 580 Z" fill="${a.depth(0.7)}"/><rect x="1530" y="590" width="30" height="50" fill="#ffc27a" opacity=".6"/><ellipse cx="1650" cy="520" rx="26" ry="18" fill="${a.depth(0.78)}" transform="rotate(-25 1650 520)"/><rect x="1647" y="528" width="5" height="20" fill="${a.depth(0.78)}"/>`);
  // Rocky banks and boulders framing both sides
  a.add(`<path d="M0 520 L160 500 L330 560 L470 600 L600 640 L640 760 L0 820 Z" fill="${a.depth(0.85)}"/><path d="M1920 500 L1780 520 L1620 580 L1440 640 L1380 780 L1920 820 Z" fill="${a.depth(0.85)}"/>`);
  a.add(tor(170, 840, 300, a.pal.dark, "#ffb07a"), tor(1760, 850, 320, a.pal.dark, "#ffb07a"), bush(420, 800, 110, a.pal.dark));
  a.ground(780, 900);
  return a;
};

S.palace = () => {
  const a = new Art(1920, { top: "#221a3e", mid: "#a24a6c", horizon: "#f7a65a", glow: "#ffd28c", dark: "#0c0914" }, 88);
  a.sky();
  a.glow(960, 560, 820);
  a.stars(40, 260);
  a.moon(1420, 180, 20);
  a.clouds(7, 220, 400, "#ffc6a8", 0.3);
  const far = a.ridge({ base: 600, amp: 40, fill: a.depth(0.3) });
  a.row(far, { count: 26, size: [50, 90], draw: (x, y, s) => roundTree(x, y, s, a.depth(0.32)) });
  a.mist(600, 110);
  // Travancore Palace: a symmetrical 1930s Lutyens-era mansion, cream facade, central columned portico
  const cream = mix("#efe0c2", a.pal.horizon, 0.18), shade = mix(cream, a.pal.mid, 0.35), win = "#ffcf86";
  const base = 610, bx = 960;
  const p = [];
  p.push(`<rect x="${bx - 380}" y="${base - 110}" width="760" height="110" fill="${shade}"/>`); // wings
  p.push(`<rect x="${bx - 390}" y="${base - 120}" width="780" height="12" fill="${cream}"/>`); // cornice
  for (let x = bx - 385; x < bx + 385; x += 10) p.push(`<rect x="${x}" y="${base - 132}" width="4" height="12" fill="${cream}"/>`); // balustrade
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { const x = bx + sx * (170 + i * 42) - 10; p.push(`<rect x="${x}" y="${base - 92}" width="20" height="40" fill="${win}" opacity=".75"/><rect x="${x}" y="${base - 42}" width="20" height="30" fill="${win}" opacity=".55"/>`); }
  p.push(`<rect x="${bx - 150}" y="${base - 150}" width="300" height="150" fill="${cream}"/>`); // central block
  p.push(`<path d="M${bx - 120} ${base - 150} L${bx} ${base - 196} L${bx + 120} ${base - 150} Z" fill="${cream}"/><path d="M${bx - 96} ${base - 154} L${bx} ${base - 186} L${bx + 96} ${base - 154} Z" fill="${shade}"/>`); // pediment
  p.push(`<rect x="${bx - 126}" y="${base - 156}" width="252" height="10" fill="${shade}"/>`);
  for (let i = 0; i < 6; i++) p.push(`<rect x="${bx - 105 + i * 40}" y="${base - 146}" width="10" height="130" fill="${mix(cream, "#ffffff", 0.2)}"/>`); // columns
  p.push(`<rect x="${bx - 40}" y="${base - 90}" width="80" height="74" fill="${win}" opacity=".7"/><rect x="${bx - 160}" y="${base - 16}" width="320" height="16" fill="${shade}"/>`); // door and steps
  a.add(...p);
  // Lawns and the wide tree-lined avenue with classic Delhi lampposts and festival flags
  a.add(`<rect x="0" y="${base}" width="1920" height="60" fill="${a.depth(0.55)}"/>`);
  a.add(`<path d="M900 ${base} L1020 ${base} L1500 1080 L420 1080 Z" fill="${a.depth(0.72)}"/>`);
  const posts = [];
  for (let i = 0; i < 6; i++) { const t = i / 5, y = base + 30 + t * 220, off = 110 + t * 520, s = 60 + t * 150; posts.push([bx - off, y, s], [bx + off, y, s]); }
  for (const [x, y, s] of posts) a.add(tallTree(x + (x < bx ? -40 : 40), y, s * 1.5, a.depth(0.75)));
  for (const [x, y, s] of posts) { a.add(lamppost(x, y, s, a.depth(0.92), "#ffe0a0")); a.glow(x, y - s * 1.08, s * 0.5, "#ffd28c", 0.5); }
  const colors = ["#fbbf24", "#2dd4bf", "#fb7185", "#818cf8", "#4ade80"];
  for (let i = 0; i < posts.length - 2; i++) { const [x1, y1, s1] = posts[i], [x2, y2, s2] = posts[i + 2]; a.add(bunting(n(x1), n(y1 - s1 * 1.05), n(x2), n(y2 - s2 * 1.05), colors)); }
  for (const [x, h, c] of [[620, 180, "#fbbf24"], [1300, 180, "#2dd4bf"]]) a.add(`<rect x="${x}" y="${base - h}" width="4" height="${h}" fill="${a.depth(0.8)}"/><path d="M${x + 4} ${base - h} l60 10 l-60 12 Z" fill="${c}"/>`);
  // Framing trees like a gateway, top corners and sides
  a.add(roundTree(90, 860, 760, a.pal.dark), roundTree(1830, 860, 760, a.pal.dark));
  a.ground(780, 900);
  return a;
};

// ------------------------------------------------------------------ the road panoramas (3840 wide, seamless)
/** A ride leg: landscape A at the seam (both ends), landscape B in the middle, blended by position.
 *  Three layers (far, mid, near); each item says which layer it stands on. */
function road(pal, seed, { a: A, b: B }) {
  const w = 3840;
  const art = new Art(w, pal, seed);
  const f = (x) => 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / w); // 0 at the seam, 1 in the middle
  const lerp = (k) => (x) => A[k] + (B[k] - A[k]) * f(x);
  art.sky();
  art.glow(w * 0.25, 610, 900, pal.glow, 0.45);
  art.glow(w * 0.75, 610, 900, pal.glow, 0.45);
  art.stars(90, 300);
  art.clouds(14, 230, 430, mix(pal.horizon, pal.mid, 0.45), 0.25);
  const layers = {
    far: art.ridge({ base: 612, amp: 1, waves: [[2, 0.5], [5, 0.3], [11, 0.15], [23, 0.05]], shape: lerp("far"), fill: art.depth(0.28) }),
  };
  art.mist(612, 130);
  layers.mid = art.ridge({ base: 660, amp: 1, waves: [[3, 0.5], [7, 0.3], [15, 0.2]], shape: lerp("mid"), fill: art.depth(0.5) });
  const place = (on, tone) => { for (const side of [A, B]) for (const item of side.items.filter((it) => it.on === on)) {
    const isA = side === A;
    art.row(layers[on], { count: item.count, size: item.size, draw: (x, y, s, sd) => item.draw(x, y, s, art.depth(tone), sd), keep: (x) => (isA ? f(x) < 0.5 : f(x) >= 0.5) });
  } };
  place("far", 0.34);
  place("mid", 0.55);
  layers.near = art.ridge({ base: 740, amp: 1, waves: [[4, 0.6], [9, 0.3], [21, 0.1]], shape: lerp("near"), fill: art.depth(0.82) });
  place("near", 0.86);
  art.ground(750, 880);
  return art;
}
const towns = (x, y, s, c) => [0, 1, 2, 3].map((k) => house(x + (k - 1.5) * s * 0.55, y + (k % 2) * 3, s * 0.42, s * 0.3, c, mix(c, "#000000", 0.2), k % 2 ? "#ffcf7a" : null)).join("");
const field = (x, y, s, c) => `<g fill="${mix(c, "#8bb36a", 0.3)}">${[0, 1, 2].map((k) => `<rect x="${n(x - s + k * 6)}" y="${n(y - 4 - k * 5)}" width="${n(s * 2 - k * 12)}" height="3"/>`).join("")}</g>`;
const ravine = (x, y, s, c) => `<path d="M${n(x - s)} ${n(y)} L${n(x - s * 0.55)} ${n(y - s * 0.55)} L${n(x - s * 0.3)} ${n(y - s * 0.4)} L${n(x + s * 0.05)} ${n(y - s * 0.85)} L${n(x + s * 0.35)} ${n(y - s * 0.6)} L${n(x + s * 0.55)} ${n(y - s * 0.7)} L${n(x + s)} ${n(y)} Z" fill="${c}"/>`;

S["road-1"] = () => road({ top: "#0b2530", mid: "#2a5a4e", horizon: "#e6a050", glow: "#ffc970", dark: "#060e0c" }, 101, {
  a: { far: 90, mid: 70, near: 60, items: [{ on: "far", count: 14, size: [50, 90], draw: (x, y, s, c) => tor(x, y, s, c) }, { on: "mid", count: 30, size: [30, 55], draw: (x, y, s, c) => bush(x, y, s, c) }, { on: "near", count: 10, size: [150, 230], draw: (x, y, s, c) => tor(x, y, s, c, "#ffcf86") }] },
  b: { far: 50, mid: 40, near: 40, items: [{ on: "far", count: 30, size: [80, 120], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }, { on: "mid", count: 16, size: [90, 140], draw: field }, { on: "near", count: 12, size: [240, 340], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }] },
});
S["road-2"] = () => road({ top: "#101a32", mid: "#3a4a3a", horizon: "#ee9c48", glow: "#ffcf72", dark: "#070a08" }, 202, {
  a: { far: 70, mid: 50, near: 50, items: [{ on: "far", count: 34, size: [90, 130], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }, { on: "near", count: 12, size: [260, 360], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }] },
  b: { far: 16, mid: 12, near: 20, items: [{ on: "far", count: 10, size: [30, 50], draw: (x, y, s, c) => acacia(x, y, s, c) }, { on: "mid", count: 46, size: [50, 70], draw: (x, y, s, c) => orchardTree(x, y, s, c, "#ffa43a") }, { on: "near", count: 20, size: [100, 140], draw: (x, y, s, c) => orchardTree(x, y, s, c, "#ff9a2a") }] },
});
S["road-3"] = () => road({ top: "#24142a", mid: "#8a4230", horizon: "#f08a52", glow: "#ffc388", dark: "#0e0706" }, 303, {
  a: { far: 20, mid: 14, near: 24, items: [{ on: "far", count: 14, size: [30, 50], draw: (x, y, s, c) => acacia(x, y, s, c) }, { on: "mid", count: 18, size: [90, 140], draw: field }, { on: "near", count: 8, size: [160, 220], draw: (x, y, s, c) => acacia(x, y, s, c) }] },
  b: { far: 190, mid: 140, near: 90, items: [{ on: "mid", count: 18, size: [80, 140], draw: ravine }, { on: "near", count: 10, size: [160, 260], draw: ravine }, { on: "far", count: 12, size: [30, 50], draw: (x, y, s, c) => bush(x, y, s, c) }] },
});
S["road-4"] = () => road({ top: "#201a3e", mid: "#8c4466", horizon: "#f5a45a", glow: "#ffd08a", dark: "#0b0912" }, 404, {
  a: { far: 30, mid: 20, near: 24, items: [{ on: "far", count: 12, size: [60, 90], draw: towns }, { on: "mid", count: 18, size: [90, 140], draw: field }, { on: "near", count: 8, size: [120, 170], draw: towns }] },
  b: { far: 20, mid: 12, near: 12, items: [{ on: "mid", count: 34, size: [120, 170], draw: (x, y, s, c) => tallTree(x, y, s, c) }, { on: "near", count: 18, size: [260, 340], draw: (x, y, s, c) => tallTree(x, y, s, c) }, { on: "near", count: 12, size: [150, 190], draw: (x, y, s, c) => lamppost(x, y, s, c, "#ffe0a0") }] },
});

// ------------------------------------------------------------------ render
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
for (const name of Object.keys(S)) {
  if (want.length && !want.includes(name)) continue;
  const svg = S[name]().svg();
  writeFileSync(new URL(`${name}.svg`, SRC), svg);
  const file = new URL(`${name}.webp`, OUT);
  await sharp(Buffer.from(svg), { density: 72 }).webp({ quality: 82, effort: 6, smartSubsample: true }).toFile(file.pathname);
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`${name.padEnd(10)} ${kb} KB${kb > 400 ? "  (over 400 KB)" : ""}`);
}
