// Kill the Live server mid-step: the projector must switch to Host Mode by itself (within ~5 s),
// show its small presenter badge, keep the game going, and the moderator view must offer "Return to Live"
// when the server is back; returning keeps the game's place.
// (The browser logs network errors while the server is down; that is expected here and not counted.)
//   node tests/fallback.mjs [port]        (starts and stops its own `wrangler dev`; needs .dev.vars)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8790);
const BASE = `http://127.0.0.1:${PORT}`;
const PIN = (await readFile(ROOT + ".dev.vars", "utf8")).match(/ADMIN_PIN=(\S+)/)?.[1] || "1234";
const persist = await mkdtemp(join(tmpdir(), "ride-fallback-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, msg) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${msg}`);
  if (!c) failures++;
};

let server = null;
async function startServer() {
  server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--persist-to", persist], { cwd: ROOT, detached: true, stdio: "ignore" });
  for (let k = 0; k < 60; k++) {
    try { if ((await fetch(`${BASE}/api/state`)).ok) return; } catch {}
    await sleep(1000);
  }
  throw new Error("wrangler dev did not start");
}
function killServer() {
  try { process.kill(-server.pid, "SIGKILL"); } catch {}
}
const up = async () => { try { return (await fetch(`${BASE}/api/state`)).ok; } catch { return false; } };

console.log(`Live server on :${PORT}`);
await startServer();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const state = () => page.evaluate(() => ({ live: __ride.live.on, screen: __ride.screenId(), badge: !document.querySelector("#modeBadge").classList.contains("hidden") && document.querySelector("#modeBadge").textContent }));
try {
  await page.goto(BASE + "/"); // Live is the default
  await page.waitForSelector("#modalInput");
  await page.fill("#modalInput", PIN);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__ride?.live.on === true);
  await page.evaluate(() => localStorage.removeItem("ride.state.v5"));
  const mod = await ctx.newPage(); // the moderator view on the same laptop
  await mod.goto(BASE + "/moderator");
  await mod.waitForSelector("#pin, #controls:not(.hidden)");
  if (await mod.isVisible("#pin")) { await mod.fill("#pin", PIN); await mod.click("#gate .btn"); } // same profile as the projector: usually already unlocked
  await page.bringToFront();
  for (let k = 0; k < 4; k++) { await page.keyboard.press("ArrowRight"); await sleep(900); } // lobby → intro → Bengaluru → websites → Q1
  await page.keyboard.press("p"); // hold the countdown
  const before = await state();
  const srv0 = await (await fetch(`${BASE}/api/state`)).json();
  ok(before.live && before.screen === "q1:ask" && srv0.slot === "q1" && srv0.phase === "open", `Live, voting open at ${before.screen}`);

  console.log("\nKill the Worker mid-step");
  killServer();
  const t0 = Date.now();
  await page.waitForFunction(() => window.__ride.live.on === false, null, { timeout: 20000 }).catch(() => {});
  const secs = (Date.now() - t0) / 1000;
  const lost = await state();
  ok(!lost.live && secs <= 7.5, `switched to Host Mode by itself after ${secs.toFixed(1)} s`);
  ok(lost.badge === "Host mode", `projector shows only the small presenter badge: “${lost.badge}”`);
  ok(lost.screen === before.screen, `game kept its place (${lost.screen})`);
  await sleep(1500);
  ok((await mod.textContent("#cStatus")).includes("Live lost"), "moderator view: “Host mode · Live lost”");
  // The game keeps going in Host Mode: B is the room's pick, → locks, ← undoes it
  await page.keyboard.press("b");
  await page.keyboard.press("ArrowRight");
  await sleep(500);
  const locked = (await page.evaluate(() => __ride.state.phase)) === "locked";
  await page.keyboard.press("ArrowLeft");
  await sleep(500);
  ok(locked && (await page.evaluate(() => __ride.state.phase)) === "ask", "Host Mode keys work while the server is down (→ locks, ← undoes)");
  await page.screenshot({ path: ROOT + "tests/screenshots/fallback-host.png" });

  console.log("\nBring the Worker back");
  await startServer();
  ok(await up(), "server is back");
  await page.waitForFunction(() => window.__ride.live.canReturn === true, null, { timeout: 15000 }).catch(() => {});
  ok(await page.evaluate(() => window.__ride.live.canReturn), "the projector knows the server is back");
  await mod.waitForSelector('[data-c="returnLive"]', { timeout: 8000 }).catch(() => {});
  ok(await mod.isVisible('[data-c="returnLive"]'), "moderator view offers “Return to Live”");
  await mod.click('[data-c="returnLive"]');
  await page.waitForFunction(() => window.__ride.live.on === true, null, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  const back = await state();
  const server = await (await fetch(`${BASE}/api/state`)).json();
  ok(back.live && back.screen === before.screen, `back to Live at the same step (${back.screen})`);
  ok(server.slot === "q1" && ["open", "closed"].includes(server.phase), `the server follows the projector again (${server.slot}, ${server.phase})`);
  ok(!pageErrors.length, "no script errors on the projector", pageErrors.join("; "));
  await page.screenshot({ path: ROOT + "tests/screenshots/fallback-back-live.png" });
} finally {
  await browser.close();
  killServer();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll fallback checks passed");
process.exit(failures ? 1 : 0);
