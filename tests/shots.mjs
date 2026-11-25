// Host Mode walkthrough at 1920×1080, fully offline: every route item, results entered by hand.
//   npm run host            (terminal 1)
//   node tests/shots.mjs [baseUrl]
// Also checks the moderator view (same laptop, BroadcastChannel) and the checkpost timer.
// Exits 1 if the fuel / score / stamps aren't what the manual entries should give.
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:4321";
const out = new URL("./screenshots/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(base + "/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__ride?.state);
const mod = await ctx.newPage();
mod.on("pageerror", (e) => errors.push("moderator: " + e.message));
await mod.setViewportSize({ width: 430, height: 900 });
await mod.goto(base + "/moderator");
await page.bringToFront();
await page.waitForTimeout(600);

const snap = (n) => page.screenshot({ path: `${out}${n}.png` });
const key = async (k, wait = 350) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(wait);
};
const ride = () => key("ArrowRight", 3000);

// The room's answers, typed by the presenter (see README: Host Mode keys)
const ENTRIES = {
  q2: ["2"], //                 tapstep: step 2 (right)
  p1: ["ArrowUp", "ArrowUp", "ArrowUp"], // petrol: 70% yes → +14 (capped at 100)
  q3: ["b"], //                 choose B (right)
  p2: ["a"], //                 landslide A (right) → −10
  q4: ["4"], //                 checkpoint gap 4 (right)
  q5: ["a"], //                 choose A (wrong) → −15
  q6: ["1", "2", "3", "4"], //  pickn: no decoys (right)
  q7: ["1", "2", "3", "4"], //  rank: FAQ first, loans last (right)
  p5: [["a"], ["c"], ["b"]], // checkpost: right, right, wrong → +10
  q8: ["1", "3", "3", "3"], //  match: songs→cloud, sacred→don't digitise (right)
  q9: ["c"], //                 choose C (right)
  p7: ["ArrowUp"], //           petrol: 50% → +10
};
let modOk = false;
let timerOk = false;

await snap("h00-intro");
await key("ArrowRight", 900); // arrive at Bengaluru
const route = await page.evaluate(() => fetch("content/en.json").then((r) => r.json()).then((c) => c.route));
for (let i = 0; i < route.length; i++) {
  const it = route[i];
  const n = String(i).padStart(2, "0");
  if (i > 0) await ride();
  await snap(`h${n}a-${it.id}-arrive`);
  if (it.kind === "question" || ["petrol", "landslide"].includes(it.pitType)) {
    await key("ArrowRight", 700);
    for (const k of ENTRIES[it.id] || []) await key(k, 200);
    if (it.type === "wordcloud") {
      for (const w of ["Clean water tracker", "Volunteer app", "Clean water tracker", "Voice line for farmers"]) {
        await key("w", 300);
        await page.keyboard.type(w);
        await key("Enter", 300);
      }
    }
    if (it.id === "q2") {
      const t = await mod.textContent("#app");
      modOk = t.includes("Ravi writes a brief");
    }
    await page.waitForTimeout(400);
    await snap(`h${n}b-${it.id}-ask`);
    await key("r", 1300);
    await snap(`h${n}c-${it.id}-reveal`);
  } else if (it.pitType === "viewpoint") {
    await key("ArrowRight", 700);
    for (let s = 0; s < it.showcases.length; s++) {
      if (s) await key("ArrowRight", 700);
      if (s === 0) await snap(`h${n}b-${it.id}-ask`);
      await key("r", 900);
      if (s === 0) await snap(`h${n}c-${it.id}-reveal`);
    }
  } else if (it.pitType === "checkpost") {
    await key("ArrowRight", 700);
    for (let s = 0; s < it.rounds.length; s++) {
      if (s) await key("ArrowRight", 700);
      for (const k of ENTRIES[it.id][s]) await key(k, 200);
      if (s === 0) {
        timerOk = await page.isVisible("#timerBox");
        await snap(`h${n}b-${it.id}-ask`);
      }
      await key("r", 900);
    }
    await snap(`h${n}c-${it.id}-reveal`);
  } else {
    await key("ArrowRight", 1100); // mechanic tips / chai timer
    await snap(`h${n}b-${it.id}-info`);
  }
}
await key("ArrowRight", 1800);
await snap("h99-summary");
const st = await page.evaluate(() => ({
  fuel: document.querySelector("#fuelPct").textContent,
  won: document.querySelector(".stat b").textContent,
  stamps: document.querySelectorAll(".passport .stamp").length,
  phase: window.__ride.state.phase,
}));
console.log(JSON.stringify(st));
const ok = st.fuel === "100%" && st.won === "7/8" && st.stamps === 7 && st.phase === "summary";
console.log(modOk ? "✓ moderator view follows offline" : "✗ moderator view did not follow");
console.log(timerOk ? "✓ checkpost 10-second timer shows on the projector" : "✗ checkpost timer missing");
console.log(ok ? "✓ fuel 100% (capped), 7/8 questions won, 7 stamps" : "✗ unexpected result");
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
process.exit(ok && modOk && timerOk && !errors.length ? 0 : 1);
