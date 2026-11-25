// Lists missing / empty / extra keys and the "reviewed" flag for every language.
//
//   node tools/check-translations.mjs                 report for all languages
//   node tools/check-translations.mjs --new xx "Name" "NativeName" [rtl]
//                                                     create content/xx.json with every key, empty
//   node tools/check-translations.mjs --sync          add any new English keys (empty) to every file
//
// Exit code is 1 if any language has missing keys, so it can run in CI.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { translatableStrings, getPath, setPath } from "../public/js/i18n.js";

const dir = fileURLToPath(new URL("../public/content/", import.meta.url));
const en = JSON.parse(await readFile(dir + "en.json", "utf8"));
const enStrings = translatableStrings(en);
const keys = Object.keys(enStrings);
const args = process.argv.slice(2);

function flatten(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, p, out);
    else out.push(p);
  }
  return out;
}

if (args[0] === "--new") {
  const [, code, name, nativeName, rtl] = args;
  if (!code || !name) throw new Error('usage: --new <code> "<English name>" "<native name>" [rtl]');
  const file = { reviewed: false, language: { code, name, nativeName: nativeName || name, dir: rtl === "rtl" ? "rtl" : "ltr" } };
  for (const k of keys) setPath(file, k, "");
  await writeFile(dir + `${code}.json`, JSON.stringify(file, null, 2) + "\n");
  console.log(`Created public/content/${code}.json with ${keys.length} empty strings.`);
  console.log(`Also add { code: "${code}", … } to LANGUAGES in public/js/i18n.js.`);
  process.exit(0);
}

const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "en.json").sort();
let anyMissing = false;
console.log(`English master: ${keys.length} translatable strings\n`);

for (const f of files) {
  const tr = JSON.parse(await readFile(dir + f, "utf8"));
  if (args[0] === "--sync") {
    let added = 0;
    for (const k of keys) if (getPath(tr, k) === undefined) { setPath(tr, k, ""); added++; }
    await writeFile(dir + f, JSON.stringify(tr, null, 2) + "\n");
    console.log(`${f}: added ${added} new key(s)`);
    continue;
  }
  const missing = keys.filter((k) => {
    const v = getPath(tr, k);
    return typeof v !== "string" || !v.trim();
  });
  const extra = flatten(tr).filter((k) => !["reviewed"].includes(k) && !k.startsWith("language.") && !keys.includes(k));
  const brokenVars = keys.filter((k) => {
    const v = getPath(tr, k);
    if (typeof v !== "string" || !v.trim()) return false;
    const want = enStrings[k].match(/\{\w+\}/g) || [];
    return want.some((w) => !v.includes(w));
  });
  const status = tr.reviewed === true ? "reviewed ✓" : "NOT reviewed";
  console.log(`${f.padEnd(9)} ${String(tr.language?.name || "?").padEnd(10)} ${status.padEnd(13)} missing ${missing.length}, extra ${extra.length}${brokenVars.length ? `, placeholders lost ${brokenVars.length}` : ""}`);
  for (const k of missing) console.log(`   missing: ${k}`);
  for (const k of extra) console.log(`   extra (ignored): ${k}`);
  for (const k of brokenVars) console.log(`   keep the {placeholder} in: ${k}`);
  if (missing.length) anyMissing = true;
}
process.exit(anyMissing ? 1 : 0);
