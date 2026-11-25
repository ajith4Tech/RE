// Host Mode walkthrough at 1920×1080, fully offline. Starts its own static server (tools/serve.mjs).
//   node tests/shots.mjs [baseUrl]
// Checks:
// - the forward walk shows every screen exactly once and in order; each stop's arrival runs once (one
//   ride per new stop); the km only increases; Stop 1 is one step with three states and no separate reveal
// - fuel: 50% at the start, +10% per question, +20% per pump (Host Mode counts the room as all on board), cap 100%
// - every roadside signboard shows during its ride (screenshot mid-ride) and is hidden at the stops
// - on every screen: nothing overlaps (scene inside its box, HUD pills apart, nothing over the rider),
//   the rider is fully visible, no placeholder or developer text, sentence case, no emoji
// - the moderator view (same laptop, BroadcastChannel) follows every screen: the on-screen text, the note,
//   "Coming next", a specific main button label, unfilled placeholders in amber; never "undefined"
// - polish: one corner radius, 8px spacing, the design tokens unchanged, no console errors or warnings
// - the rider at 1366×768 and 1280×720 on every screen
// Screenshots: tests/screenshots/host-*.png
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { flatten, phasesOf, placeholdersOf, isPlaceholder } from "../public/js/route.js";

const ROOT = new URL("../", import.meta.url).pathname;
const OUT = ROOT + "tests/screenshots/";
await mkdir(OUT, { recursive: true });
const C = JSON.parse(await readFile(ROOT + "public/content/en.json", "utf8"));
const STEPS = flatten(C);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, msg, detail = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${msg}${!c && detail ? `\n      ${detail}` : ""}`);
  if (!c) failures++;
};

// ---------------------------------------------------------------- server
let server = null;
let base = process.argv[2];
if (!base) {
  const port = 4600 + Math.floor(Math.random() * 300);
  server = spawn("node", ["tools/serve.mjs", String(port)], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
  base = await new Promise((res, rej) => {
    server.stdout.on("data", (d) => { const m = String(d).match(/http:\/\/localhost:(\d+)/); if (m) res(`http://127.0.0.1:${m[1]}`); });
    setTimeout(() => rej(new Error("serve.mjs did not start")), 8000);
  });
}
console.log(`Host Mode at ${base}`);

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const console_ = [];
const watch = (p, who) => {
  p.on("pageerror", (e) => console_.push(`${who}: ${e.message}`));
  p.on("console", (m) => ["error", "warning"].includes(m.type()) && console_.push(`${who} ${m.type()}: ${m.text()}`));
};
const page = await ctx.newPage();
watch(page, "projector");
await page.goto(base + "/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__ride?.state);
const mod = await ctx.newPage();
watch(mod, "moderator");
await mod.setViewportSize({ width: 430, height: 932 });
await mod.goto(base + "/moderator");
await page.bringToFront();
await page.waitForTimeout(800);

// ---------------------------------------------------------------- checks
/** The audience must never see these. */
const DEV_TEXT = /PLACEHOLDER|undefined|NaN|\bnull\b|TODO|\[object|\{\w+\}/;
const EMOJI = /\p{Extended_Pictographic}/u;
async function screenIssues(p, where) {
  const r = await p.evaluate(() => {
    const vis = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && Number(getComputedStyle(el).opacity) > 0.01 && !el.closest(".hidden");
    const rect = (el) => el.getBoundingClientRect();
    const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const scene = document.querySelector("#scene");
    const sb = rect(scene);
    const inner = scene.firstElementChild;
    const bike = rect(document.querySelector("#bike"));
    const st = rect(document.querySelector("#stage"));
    const sceneEls = [...scene.querySelectorAll("*")].filter((e) => vis(e) && rect(e).width && rect(e).height);
    const pills = [...document.querySelectorAll("#hud .where, #strip > *")].filter((e) => vis(e) && e.id !== "fuelDelta" && rect(e).width);
    const pillHit = pills.some((a, i) => pills.some((b, j) => j > i && hit(rect(a), rect(b))));
    const overflow = inner ? inner.getBoundingClientRect().bottom > sb.bottom + 1 || inner.scrollHeight > scene.clientHeight + 1 : false;
    const outside = sceneEls.filter((e) => { const b = rect(e); return b.right > sb.right + 1 || b.left < sb.left - 1; }).map((e) => e.getAttribute("class") || e.tagName).slice(0, 3);
    const qr = document.querySelector("#qrCard");
    return {
      text: [document.querySelector("#hud").innerText, scene.innerText, vis(qr) ? qr.innerText : "", document.querySelector("#toast").classList.contains("show") ? "" : ""].join("\n"),
      overflow, outside, pillHit,
      riderInside: bike.top >= Math.max(0, st.top) - 0.5 && bike.left >= Math.max(0, st.left) - 0.5 && bike.bottom <= Math.min(innerHeight, st.bottom) + 0.5 && bike.right <= Math.min(innerWidth, st.right) + 0.5,
      riderCovered: sceneEls.some((e) => hit(rect(e), bike)) || (vis(qr) && hit(rect(qr), bike)),
      layerAbove: Number(getComputedStyle(document.querySelector("#bikeLayerSvg")).zIndex) > 0 && !document.querySelector("#bandWrap #bike"),
    };
  });
  const bad = [];
  if (r.overflow) bad.push("scene content runs past its box");
  if (r.outside.length) bad.push(`outside the scene: ${r.outside.join(", ")}`);
  if (r.pillHit) bad.push("HUD items overlap");
  if (!r.riderInside) bad.push("rider not fully on screen");
  if (r.riderCovered) bad.push("something covers the rider");
  if (!r.layerAbove) bad.push("bike not in its own layer");
  const dev = r.text.match(DEV_TEXT);
  if (dev) bad.push(`audience sees “${dev[0]}”`);
  if (EMOJI.test(r.text)) bad.push("emoji on screen");
  if (/!/.test(r.text)) bad.push("exclamation mark outside the lobby");
  return bad.length ? [`${where}: ${bad.join("; ")}`] : [];
}
/** One corner radius and 8px spacing on everything visible in the scene and HUD. */
async function polishIssues(p, where, root = "#hud, #scene") {
  return p.evaluate(([root, where]) => {
    const out = [];
    const els = [...document.querySelectorAll(root)].flatMap((r) => [r, ...r.querySelectorAll("*")]).filter((e) => e.getClientRects().length && !(e instanceof SVGElement));
    for (const e of els) {
      const cs = getComputedStyle(e);
      const name = `${e.tagName.toLowerCase()}.${(e.getAttribute("class") || "").split(" ")[0]}`;
      for (const prop of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap"]) {
        const v = parseFloat(cs[prop]);
        // .stone-km's top margin is "auto": it sits on the milestone's base
        if (Number.isFinite(v) && Math.abs(v) % 8 !== 0 && !(prop === "marginTop" && e.matches(".stone-km"))) out.push(`${where} ${name} ${prop} ${cs[prop]}`);
      }
      const rad = parseFloat(cs.borderTopLeftRadius);
      const h = e.getBoundingClientRect().height / (parseFloat(getComputedStyle(document.querySelector("#stage") || document.body).getPropertyValue("--scale")) || 1);
      const shape = cs.borderTopLeftRadius.includes("%") || rad >= 40 || rad * 2 >= h - 1; // circles and pills are shapes, not corners
      if (rad && !shape && rad !== 16 && !e.matches(".countdown, .countdown i, .v-cd, .v-track, .v-fill, .ghost .ds-pct, .counts .bar")) out.push(`${where} ${name} radius ${cs.borderTopLeftRadius}`);
    }
    return [...new Set(out)];
  }, [root, where]);
}

const modBad = [];
async function checkMod(where, s, phase, must) {
  await mod.waitForTimeout(700);
  const t = await mod.textContent("body");
  const label = await mod.textContent('#controls [data-c="next"]').catch(() => "");
  const expectLabel = await page.evaluate(() => __ride.nextLabel());
  const bad = [];
  if (/undefined|NaN|\[object/.test(t)) bad.push("shows undefined/NaN");
  for (const m of must) if (m && !t.includes(m)) bad.push(`missing “${m.slice(0, 48)}”`);
  if (label.trim() !== expectLabel) bad.push(`main button “${label.trim()}”, expected “${expectLabel}”`);
  if (/^(Next|Next step|Submit|OK)$/i.test(label.trim())) bad.push(`vague main button “${label.trim()}”`);
  const amber = await mod.$$eval(".card.amber li", (n) => n.length);
  const want = phase === "arrive" || phase === "lobby" ? 0 : placeholdersOf(s).length;
  if (amber !== want) bad.push(`${amber} amber placeholders, expected ${want}`);
  if (bad.length) modBad.push(`${where}: ${bad.join("; ")}`);
}

// ---------------------------------------------------------------- the forward walk
const EXPECTED = ["lobby", "intro"];
for (const stop of C.stops) {
  EXPECTED.push(`arrive:${stop.id}`);
  for (const s of stop.steps) {
    const ph = phasesOf(s);
    if (ph.length > 1) for (const p of ph) EXPECTED.push(`${s.id}:${p}`);
    else EXPECTED.push(s.id);
  }
}
const st = () => page.evaluate(() => ({ i: __ride.state.i, phase: __ride.state.phase, screen: __ride.screenId(), fuel: __ride.fuel() }));
const issues = [];
const polish = [];
const seen = [];
const fuelAt = {};
let rides = 0;
let signs = [];
let shot = 0;
const snap = (name) => page.screenshot({ path: `${OUT}host-${String(++shot).padStart(2, "0")}-${name.replace(/[:>]/g, "-")}.png` });

console.log("\nForward walk (Host Mode)");
await snap("lobby");
issues.push(...(await screenIssues(page, "lobby")).filter((x) => !/exclamation/.test(x))); // the lobby may use “!”
await checkMod("lobby", STEPS[0], "lobby", [C.lobby.title]);
await mod.click('#controls [data-c="next"]'); // the moderator starts the ride: the projector has no buttons
await page.waitForTimeout(800);
ok((await st()).screen === "intro", "the moderator view's main button (“Start the ride”) drives the projector");

for (let guard = 0; guard < 80; guard++) {
  const s = await st();
  seen.push(s.screen);
  const step = STEPS[s.i];
  await page.waitForTimeout(450);
  // Host Mode: the room's answers by show of hands, typed in
  if (s.phase === "ask" && step.format === "choose") await page.keyboard.press("b");
  if (s.phase === "ask" && step.format === "pickn") for (const k of ["1", "2", "4"]) await page.keyboard.press(k);
  if (s.phase === "ask" && step.format === "wordcloud") for (const w of ["Clean water", "Rural health records", "Clean water"]) { await page.keyboard.press("w"); await page.keyboard.type(w); await page.keyboard.press("Enter"); await page.waitForTimeout(150); }
  if (s.phase === "ask" && step.format === "dualcloud") for (const [k, w] of [["w", "Patterns in sightings"], ["n", "Who gets land"], ["w", "Gaps in field notes"]]) { await page.keyboard.press(k); await page.keyboard.type(w); await page.keyboard.press("Enter"); await page.waitForTimeout(150); }
  await page.waitForTimeout(350);
  await snap(s.screen);
  issues.push(...(await screenIssues(page, s.screen)));
  polish.push(...(await polishIssues(page, s.screen)));
  const must = s.phase === "arrive" ? [C.stops[step.stopIndex].theme] : [step.note, step.question || step.text || step.title || step.line];
  await checkMod(s.screen, step, s.phase, must);
  if (step.type === "showcase" && s.phase === "showcase") ok(await page.isVisible(".show-row.big") && !(await page.isVisible(".signboard")), "Stop 1, state 1: the two websites side by side, no question yet");
  if (step.type === "showcase" && s.phase === "ask") ok(await page.isVisible(".show-row.small") && (await page.isVisible(".signboard .q-en")) && (await page.$$eval(".dsign", (n) => n.length)) === 4, "Stop 1, state 2: cards shrink to the top, Q1 and its four options below");
  if (step.type === "showcase" && s.phase === "reveal") {
    await page.waitForTimeout(1200);
    const flipped = await page.evaluate(() => getComputedStyle(document.querySelector(".show-flip")).transform !== "none" && !!document.querySelector(".show-row.flipped"));
    ok(flipped && (await page.isVisible(".explain")) && (await page.$$eval(".dsign", (n) => n.length)) === 4, "Stop 1, state 3: results stay, the cards flip, the reveal line sits under the cards");
    await snap(`${s.screen}-flipped`);
  }
  if (step.type === "pump" && s.phase === "locked") ok((await page.textContent(".explain")).includes(step.resultLine), `${step.id}: “${step.resultLine}” under the results`);
  if (step.type === "closing") break;
  // Next: a new stop rides; screenshot the roadside signboards mid-ride
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  if (await page.evaluate(() => document.querySelector("#bike").classList.contains("riding"))) {
    rides++;
    const dest = C.stops[STEPS[s.i + 1].stopIndex];
    const seenSigns = new Set();
    for (const t of [700, 1300, 2000]) {
      await page.waitForTimeout(t === 700 ? 550 : t - (t === 1300 ? 700 : 1300));
      const vis = await page.evaluate(() => [...document.querySelectorAll(".roadsigns.on")].flatMap((g) => [...g.querySelectorAll("text")].filter((x) => { const b = x.getBoundingClientRect(); return b.right > 0 && b.left < innerWidth; }).map((x) => x.textContent)));
      vis.forEach((v) => seenSigns.add(v));
      await snap(`ride-to-${dest.id}-${t}ms`);
      issues.push(...(await screenIssues(page, `riding to ${dest.id}`)));
    }
    signs.push([dest.id, (dest.signs || []).every((x) => seenSigns.has(x)), [...seenSigns]]);
    await page.waitForTimeout(1600);
  } else await page.waitForTimeout(250);
  fuelAt[step.id] = s.fuel;
}
const final = await st();
const stats = await page.evaluate(() => __ride.stats);
console.log(`  screens: ${stats.screens.length}, rides: ${rides}, final fuel ${final.fuel}%`);
const dupes = stats.screens.filter((x, k) => stats.screens.indexOf(x) !== k);
ok(JSON.stringify(stats.screens) === JSON.stringify(EXPECTED) && !dupes.length, `forward walk: all ${EXPECTED.length} screens appear exactly once, in order`, `got ${stats.screens.join(" → ")}`);
ok(stats.arrivals.length === C.stops.length && stats.arrivals.every((a, k) => a.stop === C.stops[k].id) && rides === C.stops.length - 1, `each stop's arrival runs once (${stats.arrivals.length} arrivals, ${rides} rides)`);
ok(stats.arrivals.every((a, k) => k === 0 || a.km > stats.arrivals[k - 1].km), `km only increases: ${stats.arrivals.map((a) => a.km).join(" → ")}`);
const q1Screens = stats.screens.filter((x) => x.startsWith("q1"));
ok(JSON.stringify(q1Screens) === JSON.stringify(["q1:showcase", "q1:ask", "q1:locked", "q1:reveal"]) && !STEPS.some((s) => s.stopIndex === 0 && s.type === "reveal"), "Stop 1: one step, three states (websites, question, reveal); no separate reveal slide");
ok(stats.screens.filter((x) => x.startsWith("arrive:")).length === C.stops.length, "no stop is arrived at twice; no “same stop” screens");
// fuel: 50 + 10 per question + 20 per pump, capped at 100 (Host Mode: everyone counts)
let f = C.config.fuelStart;
const fuelBad = [];
for (const s of STEPS) {
  if (s.type === "question" || s.type === "showcase") f = Math.min(100, f + C.config.fuelPerQuestion);
  if (s.type === "pump") f = Math.min(100, f + C.config.fuelPerPump);
  if (fuelAt[s.id] != null && fuelAt[s.id] !== Math.round(f)) fuelBad.push(`${s.id}: ${fuelAt[s.id]}%, expected ${Math.round(f)}%`);
}
ok(!fuelBad.length && final.fuel === 100, "fuel: 50% start, +10% per question, +20% per pump, capped at 100%, never lost", fuelBad.join("; "));
ok(signs.length === C.stops.length - 1 && signs.every(([, all]) => all), `every roadside signboard passes during its ride (${signs.map(([id, , v]) => `${id}: ${v.join(" / ")}`).join(" · ")})`);
ok(!(await page.evaluate(() => document.querySelector(".roadsigns.on"))), "signboards are hidden once the bike arrives");
ok(!issues.length, "every screen and ride: nothing overlaps, rider fully visible, no placeholder or developer text, no emoji, no “!”", issues.join("\n      "));
ok(!modBad.length, "moderator view on every screen: on-screen text, note, specific button label, amber placeholders, never “undefined”", modBad.join("\n      "));
ok(!polish.length, "one corner radius (16px) and 8px spacing everywhere on the projector", polish.slice(0, 12).join("\n      "));

// ---------------------------------------------------------------- the design is unchanged
const tokens = await page.evaluate(() => {
  const cs = (sel) => getComputedStyle(document.querySelector(sel));
  const root = getComputedStyle(document.documentElement);
  return {
    bg: getComputedStyle(document.querySelector("#stage")).backgroundColor,
    palette: ["--bg", "--surface", "--line", "--ink", "--ink-2", "--teal", "--tint", "--marigold"].map((v) => root.getPropertyValue(v).trim()),
    font: cs("#hudWhere").fontFamily,
    closing: cs(".closing").borderLeftColor,
    road: document.querySelector("#worldLayer rect:nth-of-type(2)").getAttribute("fill"),
  };
});
ok(JSON.stringify(tokens.palette) === JSON.stringify(["#F7F3EC", "#FFFFFF", "#E6E0D6", "#22252B", "#6B7078", "#2F6F62", "#DDEBE7", "#E8A33D"]) && tokens.bg === "rgb(247, 243, 236)" && /^"?Glacial/.test(tokens.font) && tokens.road === "#2F6F62", "design tokens unchanged: palette, cream stage, Glacial typeface, teal road");

// ---------------------------------------------------------------- the rider at smaller projector resolutions
const smallBad = [];
for (const [w, h] of [[1366, 768], [1280, 720]]) {
  const p2 = await ctx.newPage();
  watch(p2, `projector ${w}×${h}`);
  await p2.setViewportSize({ width: w, height: h });
  await p2.goto(base + "/?mode=host");
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    for (const phase of [...(s.stepIndex === 0 && s.stopIndex >= 0 ? ["arrive"] : []), ...phasesOf(s)]) {
      await p2.evaluate(([i, phase]) => localStorage.setItem("ride.state.v5", JSON.stringify({ i, phase, manual: {}, final: {}, closed: {}, words: [] })), [i, phase]);
      await p2.reload();
      await p2.waitForFunction(() => window.__ride?.state);
      await p2.waitForTimeout(500);
      smallBad.push(...(await screenIssues(p2, `${w}×${h} ${s.id} ${phase}`)).filter((x) => /rider|overlap|runs past/.test(x)));
    }
  }
  await p2.close();
}
ok(!smallBad.length, "1366×768 and 1280×720: rider fully visible and nothing overlaps on every screen", smallBad.join("\n      "));

// The moderator view at phone size, on its own
const modPolish = await polishIssues(mod, "moderator", "body");
ok(!modPolish.length, "moderator view: one corner radius and 8px spacing", modPolish.slice(0, 10).join("\n      "));
await mod.screenshot({ path: `${OUT}host-moderator.png`, fullPage: true });
ok(await mod.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "moderator view at 430px: no horizontal scroll");
const titles = await Promise.all([page, mod].map((p) => p.title()));
ok(titles[0] === "The Ride · Tech4Good" && titles[1].endsWith("The Ride · Tech4Good"), `page titles: ${titles.join(" | ")}`);

ok(!console_.length, "no console errors or warnings (projector, moderator)", console_.slice(0, 8).join("\n      "));
console.log(`\n${shot} screenshots in tests/screenshots/`);
await browser.close();
server?.kill();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll Host Mode checks passed");
process.exit(failures ? 1 : 0);
