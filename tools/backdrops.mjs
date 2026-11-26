// The Ride: backdrop generator. Draws every stop's backdrop as a layered flat-vector SVG (one shared
// style: sky → hazy far layers → darker near layers → dark framing silhouettes → dark ground), saves the
// source to design/backdrops/<name>.svg and renders public/img/scenes/<name>.webp with sharp.
//   node tools/backdrops.mjs            all backdrops
//   node tools/backdrops.mjs forest     just one (or several names)
// Scenes are 1920×1080. Road panoramas are 3840×1080 and tile seamlessly (every wave and object wraps).
// Composition rules from the projector: calm middle 60%, detail at the edges and in the sky, quiet top 10%
// (the chapter line). One world (public/js/scenes.js): every far horizon sits on HORIZON (y 600), the near
// ground runs down to the road edge (y 887) in the scene's ground colour, and the palettes follow the story's
// time of day. Each scene renders as two layers for parallax: <name>-far.webp (sky, far hills, haze) and
// <name>-near.webp (everything nearer, transparent above it). The sun is drawn by the projector (it must not
// pan with the panoramas).
import sharp from "sharp";
import { mkdirSync, writeFileSync, statSync, rmSync, existsSync } from "node:fs";
import { PAL, HORIZON, groundOf } from "../public/js/scenes.js";

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
  constructor(w, name, seed) {
    Object.assign(this, { w, name, pal: PAL[name], r: rng(seed), defs: [], out: [], ids: 0, cut: null });
    this.periodic = w > 1920; // panoramas wrap
  }
  /** Everything drawn so far is the far layer; everything after it, the near layer. */
  split() { this.cut = this.out.length; }
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
    const night = this.pal.night ?? 1;
    count = Math.round(count * night);
    for (let i = 0; i < count; i++) {
      const x = this.r() * this.w;
      const y = 70 + this.r() ** 1.4 * (yMax - 70);
      this.wrap(x, 4, (xx) => `<circle cx="${n(xx)}" cy="${n(y)}" r="${n(0.8 + this.r() * 1.6)}" fill="#fff7e6" opacity="${n((0.25 + this.r() * 0.55) * Math.min(1, 0.3 + night))}"/>`);
    }
  }
  moon(x, y, r, color = "#fff1d0") {
    if ((this.pal.night ?? 1) < 0.5) return;
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
  /** The near ground: fades in from `from` and is solid by `to` (just above the road edge), in the scene's
   *  ground colour, the same colour the projector's verge strip starts from, so there is no seam. */
  ground(from = 700, to = 840) {
    const id = this.id("gr");
    const g = groundOf(this.name);
    this.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g}" stop-opacity="0"/><stop offset="${n((to - from) / (H - from))}" stop-color="${g}" stop-opacity="1"/><stop offset="1" stop-color="${g}"/></linearGradient>`);
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
  /** part: "far" (up to the split), "near" (after it, transparent elsewhere) or the whole scene. */
  svg(part) {
    const k = this.cut ?? this.out.length;
    const body = part === "far" ? this.out.slice(0, k) : part === "near" ? this.out.slice(k) : this.out;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${H}" viewBox="0 0 ${this.w} ${H}"><defs>${this.defs.join("")}</defs>${body.join("")}</svg>`;
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
// Calm by design: an open landscape the road runs through, one landmark per stop kept to the sides, nothing
// busy in the middle (the card sits there), no framing silhouettes. The near ground runs down into the road.
const S = {};
const sideOnly = (x) => x < 470 || x > 1450;
/** A low town skyline between x0 and x1, standing on y; a few lit windows when lit is given. */
function skyline(a, x0, x1, y, fill, lit, tall = 60) {
  const out = [];
  for (let x = x0; x < x1;) {
    const w = 18 + a.r() * 34, mid = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2));
    const h = 14 + a.r() * 20 + Math.max(0, mid) * a.r() * tall;
    out.push(`<rect x="${n(x)}" y="${n(y - h)}" width="${n(w)}" height="${n(h + 4)}" fill="${fill}"/>`);
    if (lit) for (let k = 0; k < h / 14; k++) if (a.r() < 0.22) out.push(`<rect x="${n(x + 4 + a.r() * (w - 10))}" y="${n(y - h + 6 + k * 12)}" width="3" height="4" fill="${lit}" opacity=".55"/>`);
    x += w + 2 + (a.r() < 0.3 ? 8 + a.r() * 26 : 0);
  }
  a.add(...out);
}
/** The standard calm layout: sky and glow, far hills, haze (far layer); mid hills, edge items, ground (near). */
function base(name, seed, { glowX = 960, far = {}, mid = {}, farItems, midItems, stars = 0, clouds = 3, landmarkFar, landmarkNear, groundFrom = 720 }) {
  const a = new Art(1920, name, seed);
  a.sky();
  a.glow(glowX, HORIZON, 900, a.pal.glow, 0.55);
  if (stars) a.stars(stars, 300);
  a.clouds(clouds, 260, 430, mix(a.pal.horizon, a.pal.top, 0.35), 0.16);
  landmarkFar?.(a);
  const f = a.ridge({ base: HORIZON + 4, amp: far.amp ?? 50, waves: far.waves, shape: far.shape || ((x) => 0.3 + 0.7 * edge(1920)(x)), fill: a.depth(0.26) });
  farItems?.(a, f);
  a.mist(HORIZON, 160, a.pal.horizon, 0.4);
  a.split();
  const m = a.ridge({ base: mid.base ?? 700, amp: mid.amp ?? 50, waves: [[2, 0.5], [5, 0.3], [11, 0.2]], shape: mid.shape || ((x) => 0.2 + 0.8 * edge(1920)(x)), fill: a.depth(0.5) });
  midItems?.(a, m);
  landmarkNear?.(a, m);
  a.ground(groundFrom, 860);
  return a;
}

S.prologue = () => base("prologue", 11, {
  glowX: 1180, stars: 25,
  landmarkFar: (a) => skyline(a, 1160, 1620, HORIZON + 6, a.depth(0.32), "#ffd88f", 70),
  midItems: (a, m) => a.row(m, { count: 10, size: [70, 110], draw: (x, y, s) => rainTree(x, y, s, a.depth(0.55)), keep: sideOnly }),
});

S.workbench = () => base("workbench", 22, {
  glowX: 960,
  landmarkFar: (a) => skyline(a, 300, 1650, HORIZON + 6, a.depth(0.22), null, 40),
  // Bengaluru street at the left edge: low shopfronts; the Tech4Good garage with its shutter up and a teal glow
  landmarkNear: (a, m) => {
    const y = 712;
    for (const [x, w, h] of [[-20, 150, 120], [140, 120, 96], [270, 170, 130]]) a.add(`<rect x="${x}" y="${y - h}" width="${w}" height="${h + 40}" fill="${a.depth(0.62)}"/><rect x="${x - 6}" y="${y - h - 8}" width="${w + 12}" height="10" fill="${a.depth(0.68)}"/>`);
    a.add(`<rect x="290" y="${y - 84}" width="130" height="84" fill="#2dd4bf" opacity=".28"/><rect x="290" y="${y - 96}" width="130" height="12" fill="${a.depth(0.72)}"/>`);
    a.glow(355, y - 30, 160, "#2dd4bf", 0.25);
    a.row(m, { count: 6, size: [140, 200], draw: (x, y, s) => rainTree(x, y, s, a.depth(0.56)), keep: (x) => x > 1460 });
  },
});

S.forest = () => base("forest", 33, {
  glowX: 640, far: { amp: 70 },
  farItems: (a, f) => {
    a.row(f, { count: 34, size: [40, 70], draw: (x, y, s, sd) => teak(x, y, s, a.depth(0.3), sd), keep: (x) => x < 700 || x > 1250 });
    const tx = 1560, ty = f(1560) + 4, c = a.depth(0.38); // the forest watchtower
    a.add(`<g stroke="${c}" stroke-width="5" fill="none"><path d="M${tx - 30} ${ty} L${tx - 16} ${ty - 130} M${tx + 30} ${ty} L${tx + 16} ${ty - 130} M${tx - 26} ${ty - 26} L${tx + 20} ${ty - 96} M${tx + 26} ${ty - 26} L${tx - 20} ${ty - 96}"/></g><rect x="${tx - 30}" y="${ty - 166}" width="60" height="38" fill="${c}"/><path d="M${tx - 42} ${ty - 164} L${tx} ${ty - 194} L${tx + 42} ${ty - 164} Z" fill="${c}"/>`);
  },
  midItems: (a, m) => {
    a.row(m, { count: 14, size: [130, 200], draw: (x, y, s, sd) => teak(x, y, s, a.depth(0.55), sd), keep: sideOnly });
    a.row(m, { count: 10, size: [40, 70], draw: (x, y, s) => bush(x, y, s, a.depth(0.58)), keep: (x) => x > 500 && x < 1420 });
  },
});

S.village = () => base("village", 44, {
  glowX: 1300,
  farItems: (a, f) => a.row(f, { count: 12, size: [50, 80], draw: (x, y, s) => palm(x, y, s, a.depth(0.3)), keep: (x) => x < 650 || x > 1300 }),
  landmarkNear: (a, m) => {
    // Village houses with tiled roofs on the right; a banyan on the left
    for (const [x, w, h] of [[1480, 100, 56], [1590, 120, 64], [1720, 110, 60], [1840, 120, 66]]) a.add(house(x, 712 + (x % 3) * 3, w, h, a.depth(0.62), mix(a.depth(0.6), "#7a3020", 0.45), x % 2 ? "#ffcb72" : null));
    a.add(banyan(250, 716, 300, a.depth(0.6), 0.3));
    a.row(m, { count: 5, size: [80, 120], draw: (x, y, s) => palm(x, y, s, a.depth(0.55)), keep: (x) => x > 520 && x < 640 || x > 1380 && x < 1470 });
  },
});

S.pump = () => base("pump", 55, {
  glowX: 1250, far: { amp: 20, shape: () => 1 }, mid: { amp: 18, shape: () => 1 },
  farItems: (a, f) => a.row(f, { count: 12, size: [30, 50], draw: (x, y, s) => acacia(x, y, s, a.depth(0.3)), keep: (x) => x < 700 || x > 1250 }),
  landmarkNear: (a) => {
    // The petrol pump on the right: canopy lights, two dispensers, a kiosk; one acacia on the left
    const c = a.depth(0.66);
    a.glow(1640, 680, 340, "#ffd27a", 0.4);
    a.add(`<rect x="1450" y="560" width="420" height="30" fill="${c}"/><rect x="1450" y="590" width="420" height="7" fill="#fff1c8" opacity=".8"/><rect x="1480" y="597" width="12" height="120" fill="${c}"/><rect x="1830" y="597" width="12" height="120" fill="${c}"/>`);
    for (const x of [1580, 1710]) a.add(`<rect x="${x}" y="640" width="48" height="80" rx="6" fill="${a.depth(0.72)}"/><rect x="${x + 9}" y="650" width="30" height="18" fill="#ffd27a" opacity=".7"/>`);
    a.add(`<rect x="1330" y="636" width="100" height="80" fill="${a.depth(0.66)}"/><rect x="1346" y="654" width="34" height="26" fill="#ffcf72" opacity=".6"/>`);
    a.add(acacia(260, 716, 300, a.depth(0.6)));
  },
});

S.records = () => base("records", 66, {
  glowX: 800,
  landmarkFar: (a) => skyline(a, 260, 1700, HORIZON + 6, a.depth(0.3), "#ffd38a", 55),
  // Nagpur's Zero Mile: the sandstone pillar on its plinth with four horses, on the right
  landmarkNear: (a, m) => {
    const x = 1560, y = 712;
    a.glow(x, y - 140, 220, "#ffe2a8", 0.35);
    a.add(`<rect x="${x - 70}" y="${y - 24}" width="140" height="28" fill="#b79a74"/><rect x="${x - 44}" y="${y - 50}" width="88" height="28" fill="#cdb187"/><path d="M${x - 22} ${y - 50} L${x - 13} ${y - 290} L${x + 13} ${y - 290} L${x + 22} ${y - 50} Z" fill="#e2c99c"/><rect x="${x - 24}" y="${y - 304}" width="48" height="16" fill="#cdb187"/><path d="M${x - 14} ${y - 304} L${x} ${y - 330} L${x + 14} ${y - 304} Z" fill="#cdb187"/>`);
    for (const dx of [-62, -36, 36, 62]) a.add(`<path d="M${x + dx - 12} ${y - 24} l3 -16 l13 -3 l5 -8 l4 8 l-4 19 Z" fill="#9a8060"/>`);
    a.row(m, { count: 8, size: [100, 150], draw: (x, y, s) => roundTree(x, y, s, a.depth(0.55)), keep: (x) => x < 450 });
  },
});

S.bridge = () => base("bridge", 77, {
  glowX: 1000, stars: 20, far: { amp: 140, waves: [[1, 0.4], [3, 0.3], [6, 0.2], [14, 0.12]], shape: (x) => 0.35 + 0.65 * edge(1920)(x) },
  farItems: (a, f) => {
    // Jhansi Fort on the far left hill
    const fx = 420, fy = f(fx) + 10, c = a.depth(0.36), o = [`<path d="M${fx - 110} ${fy} L${fx - 100} ${fy - 54} L${fx + 110} ${fy - 54} L${fx + 120} ${fy} Z"/>`];
    for (const bx of [-100, -36, 36, 100]) o.push(`<rect x="${fx + bx - 16}" y="${fy - 82}" width="32" height="36"/>`);
    o.push(`<rect x="${fx - 11}" y="${fy - 118}" width="22" height="46"/>`);
    a.add(`<g fill="${c}">${o.join("")}</g>`);
  },
  landmarkNear: (a) => {
    // The river and the broken footbridge, low across the middle
    a.add(`<rect x="0" y="650" width="1920" height="70" fill="${mix(a.pal.horizon, a.pal.dark, 0.5)}"/>`);
    for (const [x, y, w] of [[820, 664, 200], [980, 684, 140], [740, 700, 180]]) a.add(`<rect x="${x}" y="${y}" width="${w}" height="3" fill="${a.pal.glow}" opacity=".3"/>`);
    const half = (x0, x1) => `<path d="M${x0} 630 Q${(x0 + x1) / 2} 650 ${x1} 690" stroke="${a.depth(0.7)}" stroke-width="5" fill="none"/><path d="M${x0} 642 Q${(x0 + x1) / 2} 662 ${x1} 702" stroke="${a.depth(0.7)}" stroke-width="3" fill="none"/>`;
    a.add(`<rect x="560" y="600" width="10" height="60" fill="${a.depth(0.7)}"/><rect x="1350" y="600" width="10" height="60" fill="${a.depth(0.7)}"/>`, half(565, 860), half(1355, 1060));
    a.add(tor(200, 716, 170, a.depth(0.6), a.pal.light), tor(1730, 716, 190, a.depth(0.6), a.pal.light));
  },
});

S.palace = () => base("palace", 88, {
  glowX: 960, stars: 40, far: { amp: 30 },
  farItems: (a, f) => a.row(f, { count: 22, size: [40, 70], draw: (x, y, s) => roundTree(x, y, s, a.depth(0.3)), keep: (x) => x < 560 || x > 1360 }),
  // Travancore Palace in its evening lights, the avenue's lamps along both sides
  landmarkNear: (a) => {
    const cream = mix("#efe0c2", a.pal.horizon, 0.3), shade = mix(cream, a.pal.mid, 0.45), win = "#ffcf86", bx = 960, b0 = 640;
    const p = [`<rect x="${bx - 340}" y="${b0 - 96}" width="680" height="96" fill="${shade}"/>`, `<rect x="${bx - 350}" y="${b0 - 106}" width="700" height="10" fill="${cream}"/>`];
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) p.push(`<rect x="${bx + sx * (160 + i * 38) - 9}" y="${b0 - 78}" width="18" height="34" fill="${win}" opacity=".7"/>`);
    p.push(`<rect x="${bx - 130}" y="${b0 - 132}" width="260" height="132" fill="${cream}"/><path d="M${bx - 108} ${b0 - 132} L${bx} ${b0 - 172} L${bx + 108} ${b0 - 132} Z" fill="${cream}"/>`);
    for (let i = 0; i < 6; i++) p.push(`<rect x="${bx - 92 + i * 35}" y="${b0 - 126}" width="9" height="112" fill="${mix(cream, "#ffffff", 0.15)}"/>`);
    p.push(`<rect x="${bx - 34}" y="${b0 - 76}" width="68" height="62" fill="${win}" opacity=".65"/>`);
    a.add(...p);
    a.glow(bx, b0 - 70, 420, "#ffd28c", 0.3);
    for (const x of [180, 420, 1500, 1740]) { a.add(lamppost(x, 716, 150, a.depth(0.66), "#ffe0a0")); a.glow(x, 716 - 162, 70, "#ffd28c", 0.5); }
  },
});

// ------------------------------------------------------------------ the road panoramas (3840 wide, seamless)
/** A ride leg: landscape A at the seam (both ends), landscape B in the middle, blended by position.
 *  Three layers (far, mid, near); each item says which layer it stands on. */
function road(name, seed, { a: A, b: B }) {
  const w = 3840;
  const art = new Art(w, name, seed);
  const pal = art.pal;
  const f = (x) => 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / w); // 0 at the seam, 1 in the middle
  const lerp = (k) => (x) => A[k] + (B[k] - A[k]) * f(x);
  art.sky();
  art.glow(w * 0.25, 610, 900, pal.glow, 0.45);
  art.glow(w * 0.75, 610, 900, pal.glow, 0.45);
  art.stars(50, 300);
  art.clouds(8, 260, 430, mix(pal.horizon, pal.top, 0.35), 0.16);
  const layers = {
    far: art.ridge({ base: HORIZON + 6, amp: 1, waves: [[2, 0.5], [5, 0.3], [11, 0.15], [23, 0.05]], shape: lerp("far"), fill: art.depth(0.28) }),
  };
  art.mist(HORIZON + 4, 130);
  const place = (on, tone) => { for (const side of [A, B]) for (const item of side.items.filter((it) => it.on === on)) {
    if (!layers[on]) continue;
    const isA = side === A;
    // Foreground items stay small and sparse: the riders, not the scenery, are in front
    const near = on === "near";
    art.row(layers[on], { count: near ? Math.ceil(item.count * 0.55) : item.count, size: near ? item.size.map((v) => v * 0.6) : item.size, draw: (x, y, s, sd) => item.draw(x, y, s, art.depth(tone), sd), keep: (x) => (isA ? f(x) < 0.5 : f(x) >= 0.5) });
  } };
  place("far", 0.34);
  art.split();
  layers.mid = art.ridge({ base: 660, amp: 1, waves: [[3, 0.5], [7, 0.3], [15, 0.2]], shape: lerp("mid"), fill: art.depth(0.5) });
  place("mid", 0.55);
  layers.near = art.ridge({ base: 740, amp: 1, waves: [[4, 0.6], [9, 0.3], [21, 0.1]], shape: (x) => lerp("near")(x) * 0.6, fill: art.depth(0.66) });
  place("near", 0.7);
  art.ground(750, 880);
  return art;
}
const towns = (x, y, s, c) => [0, 1, 2, 3].map((k) => house(x + (k - 1.5) * s * 0.55, y + (k % 2) * 3, s * 0.42, s * 0.3, c, mix(c, "#000000", 0.2), k % 2 ? "#ffcf7a" : null)).join("");
const field = (x, y, s, c) => `<g fill="${mix(c, "#8bb36a", 0.3)}">${[0, 1, 2].map((k) => `<rect x="${n(x - s + k * 6)}" y="${n(y - 4 - k * 5)}" width="${n(s * 2 - k * 12)}" height="3"/>`).join("")}</g>`;
const ravine = (x, y, s, c) => `<path d="M${n(x - s)} ${n(y)} L${n(x - s * 0.55)} ${n(y - s * 0.55)} L${n(x - s * 0.3)} ${n(y - s * 0.4)} L${n(x + s * 0.05)} ${n(y - s * 0.85)} L${n(x + s * 0.35)} ${n(y - s * 0.6)} L${n(x + s * 0.55)} ${n(y - s * 0.7)} L${n(x + s)} ${n(y)} Z" fill="${c}"/>`;

S["road-1"] = () => road("road-1", 101, {
  a: { far: 90, mid: 70, near: 60, items: [{ on: "far", count: 14, size: [50, 90], draw: (x, y, s, c) => tor(x, y, s, c) }, { on: "mid", count: 30, size: [30, 55], draw: (x, y, s, c) => bush(x, y, s, c) }, { on: "near", count: 10, size: [150, 230], draw: (x, y, s, c) => tor(x, y, s, c, "#ffcf86") }] },
  b: { far: 50, mid: 40, near: 40, items: [{ on: "far", count: 30, size: [80, 120], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }, { on: "mid", count: 16, size: [90, 140], draw: field }, { on: "near", count: 12, size: [240, 340], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }] },
});
S["road-2"] = () => road("road-2", 202, {
  a: { far: 70, mid: 50, near: 50, items: [{ on: "far", count: 34, size: [90, 130], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }, { on: "near", count: 12, size: [260, 360], draw: (x, y, s, c, sd) => teak(x, y, s, c, sd) }] },
  b: { far: 16, mid: 12, near: 20, items: [{ on: "far", count: 10, size: [30, 50], draw: (x, y, s, c) => acacia(x, y, s, c) }, { on: "mid", count: 46, size: [50, 70], draw: (x, y, s, c) => orchardTree(x, y, s, c, "#ffa43a") }, { on: "near", count: 20, size: [100, 140], draw: (x, y, s, c) => orchardTree(x, y, s, c, "#ff9a2a") }] },
});
S["road-3"] = () => road("road-3", 303, {
  a: { far: 20, mid: 14, near: 24, items: [{ on: "far", count: 14, size: [30, 50], draw: (x, y, s, c) => acacia(x, y, s, c) }, { on: "mid", count: 18, size: [90, 140], draw: field }, { on: "near", count: 8, size: [160, 220], draw: (x, y, s, c) => acacia(x, y, s, c) }] },
  b: { far: 190, mid: 140, near: 90, items: [{ on: "mid", count: 18, size: [80, 140], draw: ravine }, { on: "near", count: 10, size: [160, 260], draw: ravine }, { on: "far", count: 12, size: [30, 50], draw: (x, y, s, c) => bush(x, y, s, c) }] },
});
S["road-4"] = () => road("road-4", 404, {
  a: { far: 30, mid: 20, near: 24, items: [{ on: "far", count: 12, size: [60, 90], draw: towns }, { on: "mid", count: 18, size: [90, 140], draw: field }, { on: "near", count: 8, size: [120, 170], draw: towns }] },
  b: { far: 20, mid: 12, near: 12, items: [{ on: "mid", count: 34, size: [120, 170], draw: (x, y, s, c) => tallTree(x, y, s, c) }, { on: "near", count: 18, size: [260, 340], draw: (x, y, s, c) => tallTree(x, y, s, c) }, { on: "near", count: 12, size: [150, 190], draw: (x, y, s, c) => lamppost(x, y, s, c, "#ffe0a0") }] },
});

// ------------------------------------------------------------------ render
mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
for (const name of Object.keys(S)) {
  if (want.length && !want.includes(name)) continue;
  const art = S[name]();
  writeFileSync(new URL(`${name}.svg`, SRC), art.svg());
  const sizes = [];
  for (const part of ["far", "near"]) {
    const file = new URL(`${name}-${part}.webp`, OUT);
    await sharp(Buffer.from(art.svg(part)), { density: 72 }).webp({ quality: 82, alphaQuality: 90, effort: 6, smartSubsample: true }).toFile(file.pathname);
    sizes.push(Math.round(statSync(file).size / 1024));
  }
  // The single-image version from before the layers is replaced by the pair
  const old = new URL(`${name}.webp`, OUT);
  if (existsSync(old)) rmSync(old);
  const kb = sizes[0] + sizes[1];
  console.log(`${name.padEnd(10)} far ${sizes[0]} KB + near ${sizes[1]} KB${kb > 400 ? "  (over 400 KB)" : ""}`);
}
