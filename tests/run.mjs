// Live run, end to end: the projector, the moderator view on a phone, 150 simulated riders and two real phones.
//   node tests/run.mjs                       starts its own `wrangler dev` (ADMIN_PIN from .dev.vars)
//   node tests/run.mjs https://<public-url> <pin>   runs against the deployed Worker
// Checks:
// - API: PIN, reset, closed and malformed votes refused
// - lobby: QR code and short URL use the game's own address; "riders on board" counts every phone
// - 150 riders (WebSockets) answer by HTTP with the step id in every vote; 30 more join late and land on the
//   current step; 20 drop and reconnect mid-step and land on the current step; a real phone goes offline,
//   shows "Reconnecting…", and comes back on the current step
// - per-step scoping: a vote for an earlier step is refused; tallies and word-cloud queues start empty on
//   each step; phones forget the previous step's answer
// - fuel: 50% + (answers ÷ riders) × 10% per question, × 20% per pump, capped at 100%; the projector's numbers
//   match an independent calculation; low turnout (< 30%) pulses the gauge and warns the moderator
// - the countdown locks votes by itself when it runs out
// - word clouds: profanity filter, moderator approval, each answer in the right cloud, nothing carried over
// - every step on two phones (iPhone 13, iPhone SE): screenshot, no overlap or horizontal scroll, no
//   placeholder or developer text, targets ≥ 48px, inputs ≥ 16px, one radius, 8px spacing
// - no console errors or warnings on the projector, moderator or phones
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatten, isVote, isCloud } from "../public/js/route.js";

const ROOT = new URL("../", import.meta.url).pathname;
const OUT = ROOT + "tests/screenshots/";
await mkdir(OUT, { recursive: true });
const C = JSON.parse(await readFile(ROOT + "public/content/en.json", "utf8"));
const STEPS = flatten(C);
const devPin = async () => (await readFile(ROOT + ".dev.vars", "utf8").catch(() => "")).match(/ADMIN_PIN=(\S+)/)?.[1];
const PIN = process.argv[3] || process.env.ADMIN_PIN || (await devPin()) || "1234";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, msg, detail = "") => {
  console.log(`${c ? "  ✓" : "  ✗"} ${msg}${!c && detail ? `\n      ${detail}` : ""}`);
  if (!c) failures++;
};
const until = async (fn, ms = 10000, every = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await sleep(every);
  }
};

// ---------------------------------------------------------------- server
let server = null;
let BASE = process.argv[2];
if (!BASE) {
  const port = 8800 + Math.floor(Math.random() * 150);
  const persist = await mkdtemp(join(tmpdir(), "ride-live-"));
  server = spawn("npx", ["wrangler", "dev", "--port", String(port), "--persist-to", persist], { cwd: ROOT, detached: true, stdio: "ignore" });
  BASE = `http://127.0.0.1:${port}`;
  const up = await until(async () => { try { return (await fetch(`${BASE}/api/state`)).ok; } catch { return false; } }, 60000, 1000);
  if (!up) throw new Error("wrangler dev did not start");
}
const PUBLIC = !/^https?:\/\/(localhost|127\.|10\.|192\.168\.)/.test(BASE);
console.log(`Live at ${BASE}${PUBLIC ? " (public)" : " (local)"}`);
const api = async (path, body) => {
  const r = await fetch(BASE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: r.status, data: await r.json().catch(() => null) };
};
const admin = (body) => api("/api/admin", { pin: PIN, ...body });
const rid = () => crypto.randomUUID().replace(/-/g, "");

console.log("\nAPI");
ok((await api("/api/admin", { pin: "wrong-pin", action: "reset" })).status === 401, "wrong PIN refused");
ok((await admin({ action: "reset" })).status === 200, "reset with the PIN");
ok((await api("/api/vote", { voter: rid(), slot: "q1", answer: "A" })).status === 409, "a vote is refused when nothing is open");
ok((await api("/api/vote", { voter: rid(), slot: "q1", answer: { a: "<b>" } })).status === 400, "a malformed answer is refused");

// ---------------------------------------------------------------- browsers
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const logs = [];
let offlineWindow = false; // the phone that is deliberately offline logs network errors: expected, not counted
const watch = (p, who) => {
  p.on("pageerror", (e) => logs.push(`${who}: ${e.message}`));
  p.on("console", (m) => ["error", "warning"].includes(m.type()) && !(offlineWindow && who === "phone-se") && logs.push(`${who} ${m.type()}: ${m.text()}`));
};
const presenter = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
watch(presenter, "projector");
await presenter.goto(BASE + "/");
await presenter.waitForSelector("#modalInput");
await presenter.fill("#modalInput", PIN);
await presenter.keyboard.press("Enter");
await presenter.waitForFunction(() => window.__ride?.live.on === true);
await presenter.evaluate(() => localStorage.removeItem("ride.state.v5"));
await sleep(800);

const modCtx = await browser.newContext({ ...devices["iPhone 13"] });
const mod = await modCtx.newPage();
watch(mod, "moderator");
await mod.goto(BASE + "/moderator");
await mod.waitForSelector("#pin");
await mod.fill("#pin", PIN);
await mod.click("#gate .btn");
await mod.waitForSelector("#controls:not(.hidden)");

// Simulated riders: a WebSocket each (that is what "riders joined" counts) and a voter id each.
const riders = [];
function connectRider(k) {
  const r = (riders[k] = riders[k] || { id: rid(), first: null, last: null, open: false });
  r.first = null;
  const w = new WebSocket(BASE.replace(/^http/, "ws") + "/api/ws?role=voter");
  w.onopen = () => (r.open = true);
  w.onclose = () => (r.open = false);
  w.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data); if (m.type === "state") { r.last = m.state; r.first ||= m.state; } } catch {}
  };
  r.ws = w;
  return r;
}
for (let k = 0; k < 150; k++) connectRider(k);
const phoneCtxA = await browser.newContext({ ...devices["iPhone 13"] });
const phoneCtxB = await browser.newContext({ ...devices["iPhone SE"] });
const phoneA = await phoneCtxA.newPage();
const phoneB = await phoneCtxB.newPage();
watch(phoneA, "phone-13");
watch(phoneB, "phone-se");
await phoneA.goto(BASE + "/v");
await phoneB.goto(BASE + "/v");
const openRiders = () => riders.filter((r) => r.open).length;
const expectedRiders = () => openRiders() + 2; // + the two real phones
const projRiders = () => presenter.evaluate(() => __ride.live.riders);
await until(async () => openRiders() === 150 && (await projRiders()) === 152, 20000);

console.log("\nLobby");
ok((await projRiders()) === 152, `riders on board: ${await projRiders()} (150 simulated + 2 phones)`);
const lobby = await presenter.evaluate(() => ({ qr: !!document.querySelector("#qrBig svg"), url: document.querySelector(".qr-panel span").textContent, title: document.querySelector(".lobby h1").textContent, counter: document.querySelector("#ridersCount").dataset.target, label: document.querySelector(".lobby .riders span").textContent }));
const host = new URL(BASE).host;
ok(lobby.qr && lobby.url === `${host}/v` && lobby.title === C.lobby.title && lobby.label === C.lobby.counter, `lobby: “${lobby.title}”, QR code, short URL ${lobby.url}, “${lobby.counter} ${lobby.label}”`);
ok(PUBLIC ? !(await mod.isVisible("text=Phones can't reach this address")) : await mod.isVisible("text=Phones can't reach this address"), PUBLIC ? "public address: no local-address warning for the moderator" : "local address: the moderator is warned that phones can't reach it (deploy for the session)");
await phoneA.waitForSelector(".v-wait");
ok((await phoneA.textContent("#app")).includes(C.lobby.phoneJoined), `phone in the lobby: “${C.lobby.phoneJoined}”`);
await presenter.screenshot({ path: `${OUT}live-lobby.png` });

// ---------------------------------------------------------------- phone checks
const DEV_TEXT = /PLACEHOLDER|undefined|NaN|\bnull\b|TODO|\[object|\{\w+\}/;
const phoneBad = [];
let phoneShots = 0;
async function phoneCheck(p, name, where, lobbyOk = false) {
  if (p.isClosed()) return;
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}phone-${name}-${String(++phoneShots).padStart(3, "0")}-${where.replace(/[:>]/g, "-")}.png`, fullPage: true });
  const r = await p.evaluate(() => {
    const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
    const bad = [];
    for (const e of document.querySelectorAll("button, a, input")) {
      if (!vis(e) || e.closest(".skip")) continue;
      const b = e.getBoundingClientRect();
      if (b.height < 48 - 0.5) bad.push(`${e.tagName.toLowerCase()} ${Math.round(b.height)}px tall`);
      if (e.tagName === "INPUT" && parseFloat(getComputedStyle(e).fontSize) < 16) bad.push("input under 16px (zooms on iOS)");
    }
    for (const e of document.querySelectorAll("#app *, .v-head *")) {
      if (!vis(e)) continue;
      const cs = getComputedStyle(e);
      for (const prop of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap"]) {
        const v = parseFloat(cs[prop]);
        if (Number.isFinite(v) && Math.abs(v) % 8 !== 0) bad.push(`${e.tagName.toLowerCase()}.${(e.getAttribute("class") || "").split(" ")[0]} ${prop} ${cs[prop]}`);
      }
      const rad = parseFloat(cs.borderTopLeftRadius);
      if (rad && rad !== 16 && !(rad * 2 >= e.getBoundingClientRect().height - 1) && !cs.borderTopLeftRadius.includes("%") && !e.matches(".v-cd, .v-cd i, .v-track, .v-fill") && !(e instanceof SVGElement)) bad.push(`${e.tagName.toLowerCase()}.${e.getAttribute("class")} radius ${cs.borderTopLeftRadius}`);
    }
    return { text: document.body.innerText, scroll: document.documentElement.scrollWidth > innerWidth + 0.5, bad: [...new Set(bad)] };
  });
  const issues = [...r.bad];
  if (r.scroll) issues.push("horizontal scroll");
  const dev = r.text.match(DEV_TEXT);
  if (dev) issues.push(`shows “${dev[0]}”`);
  if (/\p{Extended_Pictographic}/u.test(r.text)) issues.push("emoji");
  if (!lobbyOk && /!/.test(r.text)) issues.push("exclamation mark");
  if (issues.length) phoneBad.push(`${name} ${where}: ${issues.slice(0, 4).join("; ")}`);
}

// ---------------------------------------------------------------- walking the route
const screen = () => presenter.evaluate(() => __ride.screenId());
async function next() {
  const before = await screen();
  await presenter.keyboard.press("ArrowRight");
  await sleep(150);
  if (await presenter.evaluate(() => document.querySelector("#bike").classList.contains("riding"))) await sleep(3400);
  await until(async () => (await screen()) !== before, 5000);
  await sleep(500);
  return screen();
}
/** The current server slot as the simulated riders last heard it. */
const serverState = async () => (await api("/api/state")).data;
const vote = (r, slot, answer) => api("/api/vote", { voter: r.id, slot, answer });
async function inBatches(list, fn, size = 25) {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(fn));
}
// How each step is answered: which simulated riders (by index), what they pick, and what the phones do.
const PLAN = {
  q1: { sims: 60, answer: (k) => "ABCD"[k % 4], phones: ["A", "B"] },
  q2: { sims: 25, words: (k) => [{ part: "find", text: ["Patterns in sightings", "Gaps in our records", "Seasonal trends"][k % 3] }, { part: "never", text: ["Who gets land", "Who gets aid", "Who to hire"][k % 3] }], phones: ["dual", null] },
  q3: { sims: 170, answer: (k) => (k < 100 ? "B" : "ABCD"[k % 4]), phones: ["B", null] },
  pump1: { sims: 120, answer: (k) => ["daily", "sometimes", "notyet"][k % 3], phones: ["sometimes", null] },
  q4: { sims: 180, answer: (k) => (k < 120 ? "B" : "C"), phones: ["B", "C"] },
  q5: { sims: 90, answer: (k) => "ABCD"[k % 4], phones: ["C", null] },
  pump2: { sims: 91, answer: (k) => ["yes", "working", "notyet"][k % 3], phones: [null, null], autoLock: true },
  q6: { sims: 150, answer: (k) => (k < 100 ? ["owner", "fixer", "cost"] : ["design", "features", "launch"]), phones: ["picks", null] },
  q7: { sims: 40, words: (k) => [["Clean water", "Rural health records", "Girls' education"][k % 3]], phones: ["word", null] },
};
async function phoneAnswer(p, s, how) {
  if (!how || p.isClosed()) return 0;
  await p.waitForSelector("#qh", { timeout: 10000 });
  if (how === "dual") {
    await p.fill("#w-find", "Patterns in sightings");
    await p.fill("#w-never", "Who gets land");
    await p.click('[data-act="send"]');
  } else if (how === "word") {
    await p.fill("#word", "Clean water");
    await p.click('[data-act="send"]');
  } else if (how === "picks") {
    for (const id of ["owner", "fixer", "data"]) await p.click(`[data-pick="${id}"]`);
    await p.click('[data-act="send"]');
  } else await p.click(`[data-a="${how}"]`);
  await p.waitForSelector(".v-note.good", { timeout: 8000 });
  return 1;
}

let fuelExpected = C.config.fuelStart;
const fuelLog = [];
let lateOk = null;
let reconnectOk = null;
let offlineOk = null;
let scopeOk = [];
let lowOk = null;
let autoLockOk = null;
let cloudOk = [];
let memoryOk = null;
let modOk = [];

await phoneCheck(phoneA, "13", "lobby", true);
await phoneCheck(phoneB, "se", "lobby", true);
let cur = await next(); // lobby → intro
for (let guard = 0; guard < 60; guard++) {
  const st = await presenter.evaluate(() => ({ i: __ride.state.i, phase: __ride.state.phase }));
  const s = STEPS[st.i];
  await until(async () => (await serverState()).slot === s.id, 5000);
  await sleep(400);
  await phoneCheck(phoneA, "13", cur);
  await phoneCheck(phoneB, "se", cur);

  // ---- the phone that goes offline (between the reveal and Lakshmi), then rejoins on the current step
  if (cur === "r2") {
    offlineWindow = true;
    await phoneCtxB.setOffline(true); // no network …
    await phoneB.evaluate(() => window.__vote.dropConnection()); // … and the open socket drops, as when signal is lost
    const shown = await until(async () => (await phoneB.textContent("#connText")) === C.ui.reconnecting, 15000);
    await phoneB.screenshot({ path: `${OUT}phone-se-offline-reconnecting.png` });
    cur = await next(); // → lakshmi while the phone is away
    await phoneCtxB.setOffline(false);
    const back = await until(async () => (await phoneB.textContent("#connText")) === C.ui.connected && (await phoneB.textContent("#app")).includes(STEPS.find((x) => x.id === "lakshmi").line), 20000);
    offlineOk = !!shown && !!back;
    await sleep(1000);
    offlineWindow = false;
    continue;
  }

  if (isVote(s) && st.phase === "ask") {
    const plan = PLAN[s.id];
    if (!plan.autoLock) await presenter.keyboard.press("p"); // pause the countdown while the test votes
    // ---- late joiners land on the current step
    if (s.id === "q3") {
      const fresh = [];
      for (let k = 150; k < 180; k++) fresh.push(connectRider(k));
      await until(() => fresh.every((r) => r.first), 10000);
      lateOk = fresh.every((r) => r.first.slot === "q3" && r.first.phase === "open");
      // ---- per-step scoping: an answer for the previous question is refused; this step starts empty
      const old = await vote(riders[0], "q1", "A");
      const tally = await presenter.evaluate(() => __ride.state.tallies.q3?.n || 0);
      scopeOk.push(old.status === 409 && tally === 0);
      // the phone that answered Q1 has forgotten it: Q3 offers the options again
      memoryOk = (await phoneA.$$eval("[data-a]:not([disabled])", (n) => n.length)) === 4;
    }
    // ---- 20 riders drop and reconnect mid-step
    if (s.id === "q4") {
      const drop = riders.slice(20, 40);
      drop.forEach((r) => r.ws.close());
      await until(() => drop.every((r) => !r.open), 5000);
      await sleep(500);
      drop.forEach((_, j) => connectRider(20 + j));
      await until(() => drop.every((r) => r.first), 10000);
      reconnectOk = drop.every((r) => r.first.slot === "q4" && r.first.phase === "open");
    }
    await until(async () => (await projRiders()) === expectedRiders(), 15000);
    const nRiders = expectedRiders();
    // simulated answers, with the step id in each one
    const sims = riders.slice(0, plan.sims);
    if (isCloud(s)) {
      await inBatches(sims, (r) => {
        const k = riders.indexOf(r);
        const entries = plan.words(k);
        return s.format === "dualcloud" ? api("/api/word", { voter: r.id, slot: s.id, entries }) : Promise.all(entries.map((text) => api("/api/word", { voter: r.id, slot: s.id, text })));
      });
      const rude = await api("/api/word", { voter: rid(), slot: s.id, ...(s.format === "dualcloud" ? { entries: [{ part: "find", text: "shit data" }] } : { text: "shit data" }) });
      cloudOk.push([`${s.id} profanity filtered`, rude.data?.reason === "rephrase"]);
    } else await inBatches(sims, (r) => vote(r, s.id, plan.answer(riders.indexOf(r))));
    const phones = (await phoneAnswer(phoneA, s, plan.phones[0])) + (await phoneAnswer(phoneB, s, plan.phones[1]));
    const nAnswers = plan.sims + phones;
    await until(async () => (await presenter.evaluate((id) => __ride.state.tallies[id]?.n || 0, s.id)) === nAnswers, 10000);
    await phoneCheck(phoneA, "13", `${cur}-answered`);
    await phoneCheck(phoneB, "se", `${cur}-answered`);
    if (s.id === "q2") {
      // low turnout: the gauge pulses (after a few seconds of voting) and the moderator is told
      await presenter.keyboard.press("p"); // resume, so the turnout clock runs
      await until(() => presenter.evaluate(() => document.querySelector("#fuel").classList.contains("low")), 15000);
      lowOk = await presenter.evaluate(() => document.querySelector("#fuel").classList.contains("low"));
      await presenter.keyboard.press("p");
    }
    if (isCloud(s)) {
      // the moderator approves answers from the queue (on the phone, through the server)
      await mod.waitForSelector("#queue .btn.ok", { timeout: 10000 });
      const other = s.id === "q7" ? "Patterns in sightings" : "Clean water";
      cloudOk.push([`${s.id} queue holds only this step's answers`, !(await mod.textContent("#queue")).includes(other)]);
      for (let k = 0; k < 4; k++) {
        await mod.click("#queue .btn.ok >> nth=0");
        await sleep(700);
      }
      await until(async () => (await presenter.evaluate(() => __ride.state.liveWords.length)) >= 3, 8000);
      await sleep(600);
      if (s.format === "dualcloud") {
        const c = await presenter.evaluate(() => ({ find: document.querySelector("#cloud-find").textContent, never: document.querySelector("#cloud-never").textContent }));
        cloudOk.push(["q2 answers land in the right cloud", /Patterns|Gaps|Seasonal/.test(c.find) && !/Who gets|Who to/.test(c.find) && /Who gets|Who to/.test(c.never)]);
      } else {
        const c = await presenter.textContent("#cloud");
        cloudOk.push(["q7 cloud shows only q7 answers", /Clean water|Rural health|Girls/.test(c) && !/Patterns|Who gets/.test(c)]);
      }
      await mod.screenshot({ path: `${OUT}live-moderator-${s.id}.png`, fullPage: true });
    }
    await presenter.screenshot({ path: `${OUT}live-${cur.replace(":", "-")}.png` });
    // ---- lock: by the moderator's main button (through the server), or by the countdown running out
    if (plan.autoLock) {
      const t0 = Date.now();
      await presenter.waitForFunction(() => __ride.state.phase === "locked", null, { timeout: 45000 }).catch(() => {});
      autoLockOk = (await presenter.evaluate(() => __ride.state.phase)) === "locked" && Date.now() - t0 < 40000;
    } else if (s.id === "q3") {
      await mod.click('#controls [data-c="next"]');
      await presenter.waitForFunction(() => __ride.state.phase === "locked", null, { timeout: 8000 }).catch(() => {});
    } else await presenter.keyboard.press("ArrowRight");
    await until(() => presenter.evaluate(() => __ride.state.phase !== "ask"), 5000);
    await sleep(900);
    cur = await screen();
    const fin = await presenter.evaluate((id) => __ride.state.final[id], s.id);
    fuelExpected = Math.min(100, fuelExpected + Math.min(1, nAnswers / nRiders) * (s.type === "pump" ? C.config.fuelPerPump : C.config.fuelPerQuestion));
    const shown = await presenter.evaluate(() => __ride.fuel());
    fuelLog.push({ id: s.id, n: fin?.n, riders: fin?.riders, wantN: nAnswers, wantRiders: nRiders, fuel: shown, want: Math.round(fuelExpected) });
    // the moderator sees the live count and the low-turnout warning
    await sleep(1500);
    const mt = await mod.textContent("#app");
    if (nAnswers / nRiders < C.config.lowTurnout) modOk.push([`${s.id}: moderator warned “Low turnout. Ask the room to join.”`, mt.includes("Low turnout. Ask the room to join.")]);
    if (!isCloud(s)) modOk.push([`${s.id}: moderator shows live votes (${nAnswers})`, mt.includes(`Live votes (${nAnswers})`)]);
    if (/undefined|NaN/.test(mt)) modOk.push([`${s.id}: moderator shows undefined`, false]);
    await presenter.screenshot({ path: `${OUT}live-${cur.replace(":", "-")}.png` });
    await phoneCheck(phoneA, "13", cur);
    await phoneCheck(phoneB, "se", cur);
    if (s.type === "pump") ok((await presenter.textContent(".explain")).includes(s.resultLine), `${s.id}: “${s.resultLine}” and “${C.ui.roomFuelled}”`);
  }
  if (s.type === "showcase" && st.phase === "reveal") ok((await phoneA.textContent("#app")).includes(s.phoneReveal), `Stop 1 reveal on phones: “${s.phoneReveal}”`);
  if (s.type === "showcase" && st.phase === "showcase") ok((await phoneA.textContent("#app")).includes(s.phoneLine), `Stop 1 websites on phones: “${s.phoneLine}”`);
  if (s.type === "closing") break;
  cur = await next();
}

console.log("\nLive run");
ok(lateOk === true, "30 late joiners land on the current step (Q3, voting open)");
ok(reconnectOk === true, "20 riders drop and reconnect mid-step and land on the current step (Q4)");
ok(offlineOk === true, "a phone that goes offline shows “Reconnecting…”, then rejoins on the current step");
ok(scopeOk.length && scopeOk.every(Boolean), "per-step scoping: a vote for an earlier step is refused; the new step's tally starts at 0");
ok(memoryOk === true, "phones forget the previous step's answer: the next question is open to answer");
for (const [m, c] of cloudOk) ok(c, `word clouds: ${m}`);
ok(lowOk === true, "low turnout (< 30%) pulses the fuel gauge");
for (const [m, c] of modOk) ok(c, m);
ok(autoLockOk === true, "pump2: votes lock by themselves when the countdown runs out");
const fuelBad = fuelLog.filter((f) => f.n !== f.wantN || f.riders !== f.wantRiders || f.fuel !== f.want);
console.log("  fuel: " + fuelLog.map((f) => `${f.id} ${f.n}/${f.riders} → ${f.fuel}%`).join(" · "));
ok(fuelLog.length === 9 && !fuelBad.length, "fuel maths: 50% + answers ÷ riders × 10% per question, × 20% per pump, capped at 100%", JSON.stringify(fuelBad));
ok(!phoneBad.length, `phones: ${phoneShots} screenshots; no overlap, horizontal scroll, placeholder or developer text; targets ≥ 48px; one radius; 8px spacing`, phoneBad.slice(0, 10).join("\n      "));
ok(!logs.length, "no console errors or warnings on the projector, the moderator view or the phones", logs.slice(0, 10).join("\n      "));
await mod.screenshot({ path: `${OUT}live-moderator-end.png`, fullPage: true });

for (const r of riders) try { r.ws.close(); } catch {}
await browser.close();
if (server) try { process.kill(-server.pid, "SIGKILL"); } catch {}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll Live checks passed");
process.exit(failures ? 1 : 0);
