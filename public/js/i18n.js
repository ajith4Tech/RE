// Shared language helpers, used by the browser pages, the Cloudflare Worker and
// tools/check-translations.mjs, so every part agrees on the same keys.
//
// English (content/en.json) is the master: structure, answers and text.
// Each translation file (content/<code>.json) holds only text, under the same keys:
//   { "reviewed": false, "language": {...}, "ui": { "go": "…" },
//     "route": { "q3": { "question": "…", "options": { "A": "…" } } } }

export const LANGUAGES = [
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", dir: "ltr" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", dir: "ltr" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", dir: "ltr" },
  { code: "mr", name: "Marathi", nativeName: "मराठी", dir: "ltr" },
  { code: "ur", name: "Urdu", nativeName: "اردو", dir: "rtl" },
  { code: "lad", name: "Ladakhi", nativeName: "ལ་དྭགས་སྐད།", dir: "ltr" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", dir: "ltr" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", dir: "ltr" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", dir: "ltr" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", dir: "ltr" },
];
export const langMeta = (code) => LANGUAGES.find((l) => l.code === code) || { code, name: code, nativeName: code, dir: "ltr" };

const TOP = ["title", "subtitle", "intro", "closingLine"];
const FIELDS = ["place", "welcome", "personaName", "role", "orgType", "shift", "scenario", "question", "reveal", "board", "prompt"];
const LISTS = ["options", "items", "steps", "buckets", "periods", "sliders", "rounds"];

/** Every translatable string in en.json as a flat map: { "route.q3.question": "What should…" } */
export function translatableStrings(en) {
  const out = {};
  for (const k of TOP) if (en[k]) out[k] = en[k];
  for (const [k, v] of Object.entries(en.ui || {})) out[`ui.${k}`] = v;
  for (const r of en.route || []) {
    const p = `route.${r.id}`;
    for (const f of FIELDS) if (typeof r[f] === "string" && r[f]) out[`${p}.${f}`] = r[f];
    for (const l of LISTS) for (const o of r[l] || []) if (o.text) out[`${p}.${l}.${o.id}`] = o.text;
    if (r.poll) {
      out[`${p}.poll.question`] = r.poll.question;
      for (const o of r.poll.options) out[`${p}.poll.options.${o.id}`] = o.text;
    }
    for (const q of r.polls || []) {
      out[`${p}.polls.${q.id}.question`] = q.question;
      for (const o of q.options) out[`${p}.polls.${q.id}.options.${o.id}`] = o.text;
    }
    (r.tips || []).forEach((t, k) => (out[`${p}.tips.${k}`] = t));
    if (r.answerText) for (const [k, v] of Object.entries(r.answerText)) out[`${p}.answerText.${k}`] = v;
  }
  return out;
}

/** Strings for one part: "ui" or a route id. Used by the AI translation endpoint. */
export function partStrings(en, part) {
  const all = translatableStrings(en);
  const prefix = part === "ui" ? "ui." : `route.${part}.`;
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(prefix)));
}

export function getPath(obj, path) {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function setPath(obj, path, value) {
  const segs = path.split(".");
  let cur = obj;
  segs.slice(0, -1).forEach((seg) => {
    if (typeof cur[seg] !== "object" || cur[seg] === null) cur[seg] = {};
    cur = cur[seg];
  });
  cur[segs[segs.length - 1]] = value;
}

export function nestStrings(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) setPath(out, k, v);
  return out;
}

/** A translated string for a path, or undefined when missing/empty. */
export function tr(file, path) {
  const v = file && getPath(file, path);
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * A copy of en with every translatable string replaced by the translation when
 * present. Ids, answers and structure always come from English, so votes are
 * counted by option id across all languages.
 */
export function localize(en, file) {
  const c = JSON.parse(JSON.stringify(en));
  if (!file) return c;
  const pick = (path, fallback) => tr(file, path) ?? fallback;
  for (const k of TOP) if (c[k]) c[k] = pick(k, c[k]);
  for (const k of Object.keys(c.ui || {})) c.ui[k] = pick(`ui.${k}`, c.ui[k]);
  for (const r of c.route || []) {
    const p = `route.${r.id}`;
    for (const f of FIELDS) if (typeof r[f] === "string") r[f] = pick(`${p}.${f}`, r[f]);
    for (const l of LISTS) for (const o of r[l] || []) if (o.text) o.text = pick(`${p}.${l}.${o.id}`, o.text);
    if (r.poll) {
      r.poll.question = pick(`${p}.poll.question`, r.poll.question);
      for (const o of r.poll.options) o.text = pick(`${p}.poll.options.${o.id}`, o.text);
    }
    for (const q of r.polls || []) {
      q.question = pick(`${p}.polls.${q.id}.question`, q.question);
      for (const o of q.options) o.text = pick(`${p}.polls.${q.id}.options.${o.id}`, o.text);
    }
    if (r.tips) r.tips = r.tips.map((t, k) => pick(`${p}.tips.${k}`, t));
    if (r.answerText) for (const k of Object.keys(r.answerText)) r.answerText[k] = pick(`${p}.answerText.${k}`, r.answerText[k]);
  }
  if (file.language) c.language = { ...c.language, ...file.language };
  return c;
}

/** "Question {n}" + { n: 3 } → "Question 3" */
export function fmt(str, vars = {}) {
  return String(str ?? "").replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

/** Gaps between pipeline steps for "checkpoint": g1 sits before steps[1], … */
export function gapsFor(item) {
  return (item.steps || []).slice(1).map((s, k) => ({ id: `g${k + 1}`, before: s, after: item.steps[k] }));
}

/**
 * The choices voters pick between for a route item (and sub-step: a viewpoint
 * poll id or a checkpost round). Used for tallies, charts and Host Mode keys.
 */
export function choicesFor(item, sub) {
  if (item.kind === "pitstop") {
    if (item.pitType === "checkpost") return item.options;
    if (item.pitType === "viewpoint") return (item.polls.find((q) => q.id === sub) || item.polls[0]).options;
    return item.poll?.options || [];
  }
  switch (item.type) {
    case "choose": return item.options;
    case "tapstep": return item.steps;
    case "checkpoint": return gapsFor(item).map((g) => ({ id: g.id, text: g.before.text }));
    case "pickn":
    case "rank":
    case "match": return item.items;
    default: return [];
  }
}
