// Host Mode walkthrough at 1920×1080, fully offline: the whole route, 7 stops and 21 steps,
// results entered by hand.
//   npm run host            (terminal 1)
//   node tests/shots.mjs [baseUrl]
// Checks:
// - a forward walk shows every screen exactly once and in order; each stop's arrival (ride, km
//   flip, persona) happens exactly once; the km only increases
// - the viewpoint's answers stay hidden until after Q1; Q5's hurdles appear one per Next
// - fuel changes only on the 5 scored questions and at pitstops
// - the moderator view (same laptop, BroadcastChannel) matches every screen, never "undefined"
// - the rider (bike + helmet) is fully visible on every screen and while riding, at 1920×1080,
//   1366×768 and 1280×720, and nothing covers it
// Screenshots: one per arrival and per step screen, in tests/screenshots/.
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:4321";
const out = new URL("./screenshots/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(base + "/?mode=host");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__ride?.state);
const mod = await ctx.newPage();
mod.on("pageerror", (e) => errors.push("moderator: " + e.message));
await mod.setViewportSize({ width: 430, height: 900 });
await mod.goto(base + "/moderator");
await page.bringToFront();
await page.waitForTimeout(600);
const en = await page.evaluate(() => fetch("content/en.json").then((r) => r.json()));
const R = await page.evaluate(() => __ride.route);

// ---------------------------------------------------------------- checks
const riderIssues = [];
async function checkRider(p, where) {
  const r = await p.evaluate(() => {
    const box = (el) => (el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" ? el.getBoundingClientRect() : null);
    const b = document.querySelector("#bike").getBoundingClientRect();
    const st = document.querySelector("#stage").getBoundingClientRect();
    const hit = (o) => o && o.width && o.left < b.right && o.right > b.left && o.top < b.bottom && o.bottom > b.top;
    const scene = [...document.querySelectorAll("#scene *")].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect()).filter((o) => o.width && o.height);
    return {
      inside: b.top >= Math.max(0, st.top) - 0.5 && b.left >= Math.max(0, st.left) - 0.5 && b.bottom <= Math.min(innerHeight, st.bottom) + 0.5 && b.right <= Math.min(innerWidth, st.right) + 0.5,
      sceneHit: scene.some(hit),
      qr: hit(box(document.querySelector("#qrCard"))),
      timer: hit(box(document.querySelector("#timerBox"))),
      layerAbove: Number(getComputedStyle(document.querySelector("#bikeLayerSvg")).zIndex) > 0 && !document.querySelector("#bandWrap #bike"),
    };
  });
  const bad = [!r.inside && "outside the stage", r.sceneHit && "covered by the scene", r.qr && "covered by the QR card", r.timer && "covered by the timer", !r.layerAbove && "bike not in its own layer"].filter(Boolean);
  if (bad.length) riderIssues.push(`${where}: ${bad.join(", ")}`);
}
const modBad = [];
async function checkMod(where, must, mustNot = []) {
  await mod.waitForTimeout(1300);
  const t = await mod.textContent("#app");
  const bad = [];
  if (/undefined|NaN/.test(t)) bad.push("shows undefined/NaN");
  for (const m of must) if (m && !t.includes(m)) bad.push(`missing “${m.slice(0, 40)}”`);
  for (const m of mustNot) if (m && t.includes(m)) bad.push(`shows “${m.slice(0, 40)}” (belongs to another screen)`);
  if (bad.length) modBad.push(`${where}: ${bad.join(", ")}`);
}
const st = () => page.evaluate(() => ({ i: __ride.state.i, sub: __ride.state.sub, phase: __ride.state.phase, hurdle: __ride.state.hurdle, screen: __ride.screenId(), fuel: document.querySelector("#fuelPct").textContent, km: document.querySelector("#odo").getAttribute("aria-label") }));
const key = async (k, wait = 350) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(wait);
};
let shot = 0;
const snap = async (name) => page.screenshot({ path: `${out}${String(++shot).padStart(2, "0")}-${name}.png` });

// The room's answers, typed by the presenter (see README: Host Mode keys)
const ENTRIES = {
  q1: ["b"], //                         choose, not scored
  p2: ["b"], //                         the shortcut: B "check where it leads" (right) → −10
  q3: ["c"], //                         choose C (right)
  p3: ["ArrowUp"], //                   petrol: 50% yes → +10
  q4: ["b"], //                         choose, not scored
  q5: ["a"], //                         choose A (second best, so wrong) → −15
  q6: ["1", "2", "2", "2", "3", "3"], // match: totals→leave, names→never, health→tokenize (right)
  q7: ["b"], //                         choose B (right)
  "p4.0": ["a"], "p4.1": ["c"], "p4.2": ["a"], // checkpost: right, right, wrong → +10
  q8: ["1", "2", "3"], //               pickn: no decoys (right)
  q9: ["c"], q10: ["b"], //             not scored
  p7: ["ArrowUp"], //                   petrol: 50% → +10 (capped at 100)
  "q1.mirror": ["b"], "q6.mirror": ["a"], "q11.mirror": ["c"],
};
// Fuel after each step: it changes only on the 5 scored questions (−15 when wrong) and at pitstops
const FUEL = { intro: 100, p1: 100, q1: 100, p2: 90, q2: 90, q3: 90, p3: 100, q4: 100, q5: 85, q6: 85, c1: 85, q7: 85, c2: 85, p4: 95, q8: 95, p5: 100, q9: 100, p6: 100, q10: 100, p7: 100, q11: 100 };
// The order a forward walk must show: lobby, then per stop its arrival and each step's screens
const EXPECTED = ["lobby"];
for (const s of en.stops) {
  EXPECTED.push(`arrive:${s.id}`);
  for (const id of s.steps) {
    const it = R.find((r) => r.id === id);
    const held = R.filter((v) => v.revealAfter === id);
    const subs = it.pitType === "viewpoint" ? it.showcases.length : it.pitType === "checkpost" ? it.rounds.length : 0;
    if (subs) for (let k = 0; k < subs; k++) EXPECTED.push(`${id}.${k}`);
    else if (it.kind === "question" && (it.mirror || held.length)) {
      EXPECTED.push(`${id}.0`);
      if (it.mirror) EXPECTED.push(`${id}.mirror`);
      for (const v of held) v.showcases.forEach((_, k) => EXPECTED.push(`${id}>reveal:${v.id}.${k}`));
    } else EXPECTED.push(id);
  }
}
EXPECTED.push("summary");

const fuelBad = [];
let heldOk = true;
let hurdleOk = null;
let dualOk = false;
let finalSignOk = false;
let timerOk = false;
let rides = 0;
const seen = [];

// ---------------------------------------------------------------- the forward walk
await snap("lobby");
await checkRider(page, "lobby");
for (let guard = 0; guard < 200; guard++) {
  let s = await st();
  if (s.phase === "summary") break;
  const it = R[s.i];
  if (seen[seen.length - 1] !== s.screen) seen.push(s.screen);
  if (s.phase === "lobby" || s.phase === "card" || s.phase === "info") {
    if (s.phase === "card") {
      await snap(`${it.stopId}-${it.id}`);
      await checkRider(page, `${it.id} card`);
      await checkMod(`${it.id}`, it.kind === "intro" ? [en.title] : [it.title, it.text]);
    }
    if (s.phase === "info") {
      await snap(`${it.stopId}-${it.id}`);
      await checkRider(page, `${it.id} info`);
      await checkMod(`${it.id}`, [it.board]);
    }
  } else if (s.phase === "arrive") {
    await snap(`arrive-${it.stopId}`);
    await checkRider(page, `arrive ${it.stopId}`);
    await checkMod(`arrive ${it.stopId}`, [it.personaName]);
  } else if (s.phase === "hurdle") {
    // one hurdle sign per Next; voting stays closed until all are shown
    const seenH = [];
    for (let h = 1; h <= it.hurdles.length; h++) {
      const x = await st();
      seenH.push([x.phase, x.hurdle, await page.$$eval(".hurdles.big .hurdle", (n) => n.length), await page.isVisible(".answers")]);
      await snap(`${it.stopId}-${it.id}-hurdle${h}`);
      await key("ArrowRight", 800);
    }
    hurdleOk = seenH.every(([ph, k, shown, answers], idx) => ph === "hurdle" && k === idx + 1 && shown === idx + 1 && !answers) && (await st()).phase === "ask";
    continue;
  } else if (s.phase === "ask") {
    const scr = s.screen;
    const entryKey = scr.endsWith(".mirror") ? `${it.id}.mirror` : it.pitType === "checkpost" ? `${it.id}.${s.sub}` : it.id;
    if (scr === "p4.0") timerOk = await page.isVisible("#timerBox");
    for (const k of ENTRIES[entryKey] || []) await key(k, 200);
    if (it.type === "wordcloud" || (it.type === "dualcloud" && !scr.endsWith(".mirror"))) {
      for (const [k, w] of [["w", "Clean water tracker"], ["w", "Volunteer app"], ["w", "Clean water tracker"], ["n", "Decide who gets aid"], ["w", "Voice line for farmers"], ["n", "Replace a field visit"]]) {
        if (it.type === "wordcloud" && k === "n") continue;
        await key(k, 300);
        await page.keyboard.type(w);
        await key("Enter", 300);
      }
      if (it.type === "dualcloud") {
        const c = await page.evaluate(() => ({ build: document.querySelector("#cloud-build").textContent, never: document.querySelector("#cloud-never").textContent }));
        dualOk = c.build.includes("Clean water tracker") && !c.build.includes("Decide who") && c.never.includes("Decide who gets aid") && c.never.includes("Replace a field visit");
      }
    }
    await page.waitForTimeout(300);
    await snap(`${it.stopId}-${scr}-ask`);
    await checkRider(page, `${scr} ask`);
    if (scr.endsWith(".mirror")) await checkMod(`${scr}`, [it.mirror.question, "Mirror poll", ...it.mirror.options.map((o) => o.text)], [it.reveal]);
    else if (it.kind === "question") await checkMod(`${scr}`, [it.question, it.role || it.personaName]);
    else if (it.poll) await checkMod(`${scr}`, [it.board, it.poll.question]);
    else if (it.pitType === "viewpoint") await checkMod(`${scr}`, [it.showcases[s.sub].title]);
    await key("r", it.type === "dualcloud" ? 2300 : 1300);
    if ((await st()).phase === "ask") await key("r", 1300); // a scored step without an entry: R again reveals anyway
    await snap(`${it.stopId}-${scr}-reveal`);
    await checkRider(page, `${scr} reveal`);
    if (it.revealAfter) heldOk &&= (await page.$$eval(".dsign.right", (n) => n.length)) === 0 && (await page.isVisible(".held-note"));
    if (it.type === "dualcloud" && !scr.endsWith(".mirror")) finalSignOk = (await page.isVisible(".final-sign")) && (await page.textContent(".final-sign")).includes("Technology is not the destination");
  } else if (s.phase === "reveal" && s.screen.includes(">reveal:")) {
    // the viewpoint's held answers, after Q1: only the viewpoint reveal, never Q1's question again
    const vp = R.find((r) => r.revealAfter === it.id);
    heldOk &&= (await page.$$eval(".dsign.right", (n) => n.length)) === vp.polls.length && (await page.isVisible(".show-card")) && !(await page.isVisible(".signboard .q-en"));
    await snap(`${it.stopId}-${s.screen.replace(">", "-")}`);
    await checkRider(page, `${s.screen}`);
    await checkMod(`${s.screen}`, [vp.showcases[Number(s.screen.split(".").pop())].title]);
  }
  // fuel after a finished step
  const before = s;
  const leaving = ["reveal", "info", "card"].includes(s.phase);
  // Next: a new stop rides (check the rider mid-ride)
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  if (await page.evaluate(() => document.querySelector("#bike").classList.contains("riding"))) {
    rides++;
    await page.waitForTimeout(900);
    await checkRider(page, "riding");
    await page.waitForTimeout(2200);
  }
  const after = await st();
  if (leaving && after.i !== before.i) {
    const id = R[before.i].id;
    if (FUEL[id] != null && before.fuel !== `${FUEL[id]}%`) fuelBad.push(`${id}: ${before.fuel}, expected ${FUEL[id]}%`);
  }
}
await page.waitForTimeout(1500);
seen.push((await st()).screen);
await snap("summary");
await checkRider(page, "summary");

const result = await page.evaluate(() => ({
  fuel: document.querySelector("#fuelPct").textContent,
  won: document.querySelector(".stat b").textContent,
  stamps: document.querySelectorAll(".passport .stamp").length,
  phase: __ride.state.phase,
  arrivals: __ride.stats.arrivals,
  screens: __ride.stats.screens,
}));
console.log(JSON.stringify({ fuel: result.fuel, won: result.won, stamps: result.stamps, phase: result.phase }));
const ok = result.fuel === "100%" && result.won === "4/5" && result.stamps === 7 && result.phase === "summary" && !fuelBad.length;
const dupes = result.screens.filter((x, k) => result.screens.indexOf(x) !== k);
const orderOk = JSON.stringify(result.screens) === JSON.stringify(EXPECTED);
const arrivalsOk = result.arrivals.length === en.stops.length && result.arrivals.every((a, k) => a.stop === en.stops[k].id) && result.arrivals.every((a, k) => k === 0 || a.km > result.arrivals[k - 1].km);
console.log(orderOk && !dupes.length ? `✓ forward walk: all ${EXPECTED.length} screens appear exactly once, in order` : `✗ forward walk: ${dupes.length ? `repeated: ${[...new Set(dupes)].join(", ")}; ` : ""}got ${result.screens.join(" → ")}\n  expected ${EXPECTED.join(" → ")}`);
console.log(arrivalsOk && rides === en.stops.length - 1 ? `✓ each of the ${en.stops.length} stops arrives exactly once (${rides} rides), km only increases: ${result.arrivals.map((a) => a.km).join(" → ")}` : `✗ arrivals ${JSON.stringify(result.arrivals)}, rides ${rides}`);
console.log(ok ? "✓ fuel 100% (capped), 4/5 scored questions won, 7 stamps; fuel changed only on scored questions and pitstops" : `✗ unexpected result ${fuelBad.join(" | ")}`);
console.log(heldOk ? "✓ viewpoint answers stay hidden at the viewpoint and are revealed after Q1 (without re-showing Q1)" : "✗ viewpoint reveal did not wait for Q1");
console.log(hurdleOk ? "✓ Q5: one hurdle sign per Next, voting opens after the last" : "✗ Q5 hurdle sequence wrong");
console.log(timerOk ? "✓ checkpost 10-second timer shows on the projector" : "✗ checkpost timer missing");
console.log(modBad.length ? `✗ moderator view doesn't match the screen:\n  ${modBad.join("\n  ")}` : "✓ moderator view matches the screen on every arrival and step (no “undefined”)");

// Every screen again at the smaller projector resolutions (same 16:9 stage, scaled down)
for (const [w, h] of [[1366, 768], [1280, 720]]) {
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: w, height: h });
  await p2.goto(base + "/?mode=host");
  for (let i = 0; i < R.length; i++) {
    const it = R[i];
    const phases = [...(it.stepIndex === 0 ? ["arrive"] : []), ...(it.kind === "intro" || it.kind === "card" ? ["card"] : it.kind === "question" || ["petrol", "landslide", "viewpoint", "checkpost"].includes(it.pitType) ? ["ask", "reveal"] : ["info"])];
    for (const phase of phases) {
      await p2.evaluate(([i, phase]) => localStorage.setItem("ride.state.v4", JSON.stringify({ i, sub: 0, phase, manual: {}, final: {}, stamps: {}, mode: "host", words: [] })), [i, phase]);
      await p2.reload();
      await p2.waitForFunction(() => window.__ride?.state);
      await p2.waitForTimeout(650);
      await checkRider(p2, `${w}×${h} ${it.id} ${phase}`);
    }
  }
  await p2.close();
}
console.log(riderIssues.length ? `✗ rider not fully visible:\n  ${riderIssues.join("\n  ")}` : "✓ rider fully visible on every screen, mid-ride, and at 1920×1080, 1366×768, 1280×720");
console.log(dualOk ? "✓ Q11: W adds to BUILD, N adds to NEVER" : "✗ Q11 clouds wrong");
console.log(finalSignOk ? "✓ Q11 reveal: final signboard appears" : "✗ Q11 final signboard missing");
console.log(`${shot} screenshots in tests/screenshots/`);
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
process.exit(ok && orderOk && !dupes.length && arrivalsOk && timerOk && dualOk && finalSignOk && heldOk && hurdleOk && !modBad.length && !riderIssues.length && !errors.length ? 0 : 1);
