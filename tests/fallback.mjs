// Kill the Live server mid-step: the projector must switch to Host Mode by itself (within ~5 s),
// show the "Live lost" badge in the presenter bar, keep the game going, and offer "Return to Live"
// when the server is back, without losing its place.
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
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const state = () => page.evaluate(() => ({ live: __ride.live.on, screen: __ride.screenId(), bar: document.querySelector("#barMode").textContent }));
try {
  await page.goto(BASE + "/"); // Live is the default
  await page.waitForSelector("#modalInput");
  await page.fill("#modalInput", PIN);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__ride?.live.on === true);
  for (const k of ["ArrowRight", "ArrowRight", "ArrowRight"]) { await page.keyboard.press(k); await sleep(900); } // lobby → arrive → intro → viewpoint vote
  const before = await state();
  ok(before.live && before.screen === "p1.0" && (await (await fetch(`${BASE}/api/state`)).json()).phase === "open", `Live, voting open at ${before.screen}`);

  console.log("\nKill the Worker mid-step");
  killServer();
  const t0 = Date.now();
  await page.waitForFunction(() => window.__ride.live.on === false, null, { timeout: 20000 }).catch(() => {});
  const secs = (Date.now() - t0) / 1000;
  const lost = await state();
  ok(!lost.live && secs <= 7.5, `switched to Host Mode by itself after ${secs.toFixed(1)} s`);
  ok(lost.bar.includes("Live lost"), `presenter bar badge: “${lost.bar}”`);
  ok(lost.screen === before.screen, `game kept its place (${lost.screen})`);
  // The game keeps going in Host Mode: R reveals, ← undoes it (back to where it was)
  await page.keyboard.press("r");
  await sleep(500);
  const revealed = (await page.evaluate(() => __ride.state.phase)) === "reveal";
  await page.keyboard.press("ArrowLeft");
  await sleep(500);
  ok(revealed && (await page.evaluate(() => __ride.state.phase)) === "ask", "Host Mode keys work while the server is down (R reveals, ← undoes)");
  await page.screenshot({ path: ROOT + "tests/screenshots/fallback-host.png" });

  console.log("\nBring the Worker back");
  await startServer();
  ok(await up(), "server is back");
  await page.waitForSelector("#btnLive:not(.hidden)", { timeout: 15000 }).catch(() => {});
  ok(await page.isVisible("#btnLive"), "“Return to Live” offered");
  await page.click("#btnLive");
  await page.waitForFunction(() => window.__ride.live.on === true, null, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  const back = await state();
  const server = await (await fetch(`${BASE}/api/state`)).json();
  ok(back.live && back.screen === before.screen, `back to Live at the same step (${back.screen})`);
  ok(server.slot === "p1.0" && server.phase === "open", `the server follows the projector again (${server.slot}, ${server.phase})`);
  await page.screenshot({ path: ROOT + "tests/screenshots/fallback-back-live.png" });
} finally {
  await browser.close();
  killServer();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll fallback checks passed");
process.exit(failures ? 1 : 0);
