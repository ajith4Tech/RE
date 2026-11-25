// End-to-end test for Live Vote mode against `wrangler dev` (or a deployed Worker).
//   npm run dev                (ADMIN_PIN=1234 in .dev.vars)
//   node tests/run.mjs [baseUrl] [pin]
// - the lobby (QR + live "riders joined"), then the whole route stop by stop, step by step
// - 150 simulated voters in 8 languages answer every question format and every pitstop; 30 more
//   phones join late and land on the current step; 20 drop and reconnect mid-route; a real Urdu
//   phone goes offline, shows "Reconnecting…", and rejoins on the current step with the same voter id
// - real phone pages in Urdu (right-to-left) and Ladakhi (Tibetan) answer through the UI
// - Q10 two-part cloud (dualcloud): 150 simulated answers, profanity filter, moderator approval
//   with BUILD / NEVER tags, both clouds on the projector, final signboard
// - answer signs on phones (≥ 64px, picked / locked states) in every language, incl. Urdu (RTL)
// - every language on a phone screen: translation, script font, direction, axe accessibility checks
// - projector at 1920×1080 with every language as the regional line (longest translations)
// - palette contrast ratios, and the automatic fallback to Host Mode
import { chromium, devices } from "playwright";
import { readFile } from "node:fs/promises";
import { expandRoute } from "../public/js/i18n.js";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const PIN = process.argv[3] || process.env.ADMIN_PIN || "1234";
const OUT = new URL("./screenshots/", import.meta.url).pathname;
const ROOT = new URL("../", import.meta.url).pathname;
const AXE = await readFile(ROOT + "node_modules/axe-core/axe.min.js", "utf8");
const en = JSON.parse(await readFile(ROOT + "public/content/en.json", "utf8"));
const R = expandRoute(en); // every step, in order, with its stop

let failures = 0;
const ok = (c, msg) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${msg}`);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, body) => {
  const r = await fetch(BASE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: r.status, data: await r.json().catch(() => null) };
};
const admin = (body) => api("/api/admin", { pin: PIN, ...body });
const rid = () => crypto.randomUUID().replace(/-/g, "");

// ---------------------------------------------------------------- palette contrast (WCAG)
console.log("Contrast (WCAG 2.x, need ≥ 4.5:1)");
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
for (const [fg, bg, what] of [
  ["#F5F1E6", "#1F5A3D", "chalk text on highway green (signs, options)"],
  ["#1A1A1A", "#F2C230", "ink on milestone yellow"],
  ["#1A1A1A", "#F5F1E6", "ink on chalk"],
  ["#F5F1E6", "#B5462B", "chalk on laterite red (boards)"],
  ["#1A1A1A", "#DCCFB8", "ink on dusty sky"],
  ["#3D3A35", "#DCCFB8", "secondary text on dusty sky"],
  ["#F2C230", "#1A1A1A", "yellow on ink (verdicts)"],
  ["#8C3520", "#DCCFB8", "phone kicker text on sky"],
]) ok(ratio(fg, bg) >= 4.5, `${ratio(fg, bg).toFixed(1)}:1  ${what}`);

// ---------------------------------------------------------------- API
console.log("\nAPI");
ok((await api("/api/admin", { pin: "wrong", action: "reset" })).status === 401, "wrong PIN rejected");
ok((await admin({ action: "reset" })).status === 200, "reset with PIN");
ok((await api("/api/vote", { voter: rid(), slot: "q1", answer: "A" })).status === 409, "vote refused when nothing is open");
ok((await api("/api/vote", { voter: rid(), slot: "q1", answer: { a: "<b>" } })).status === 400, "malformed answer rejected");

// ---------------------------------------------------------------- browsers
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const errors = [];
const watch = (p, who) => p.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));

const desk = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const presenter = await desk.newPage();
watch(presenter, "presenter");
await presenter.goto(BASE + "/?mode=host");
await presenter.evaluate(() => localStorage.clear());
await presenter.goto(BASE + "/"); // Live is the default
await presenter.waitForSelector("#modalInput");
await presenter.fill("#modalInput", PIN);
await presenter.keyboard.press("Enter");
await presenter.waitForFunction(() => window.__ride?.live.on === true);
await sleep(700);
console.log("\nProjector (Live, 1920×1080)");
ok(await presenter.isVisible("#qrBig svg"), "lobby shows the QR code");
ok((await presenter.evaluate(() => __ride.state.phase)) === "lobby" && (await presenter.isVisible("#ridersCount")), "lobby: riders-joined counter before the ride starts");

const modCtx = await browser.newContext({ ...devices["iPhone 13"] });
const mod = await modCtx.newPage();
watch(mod, "moderator");
await mod.goto(BASE + "/moderator");
await mod.waitForSelector("#pin");
await mod.fill("#pin", PIN);
await mod.click(".gate button");
await sleep(1200);

// Phone connections (what each one last heard from the server). More join late; some drop and come back.
const sockets = [];
const seen = [];
function connectSocket(k) {
  const w = new WebSocket(BASE.replace(/^http/, "ws") + "/api/ws?role=voter");
  w.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data); if (m.type === "state") seen[k] = m.state; } catch {}
  };
  sockets[k] = w;
  return w;
}
for (let k = 0; k < 150; k++) connectSocket(k);
async function phone(lang, name) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addInitScript((l) => { if (!localStorage.getItem("ride.lang")) localStorage.setItem("ride.lang", l); }, lang);
  const p = await ctx.newPage();
  watch(p, name);
  await p.goto(BASE + "/v");
  return p;
}
const ur = await phone("ur", "phone-ur");
const lad = await phone("lad", "phone-lad");
await sleep(1500);
console.log("\nPhones");
ok(seen.filter(Boolean).length === 150, "150 phone WebSockets connected");
await sleep(1200);
const riders = await presenter.evaluate(() => Number(document.querySelector("#ridersCount")?.dataset.target));
ok(riders >= 150, `lobby counter: ${riders} riders joined`);
await presenter.screenshot({ path: OUT + "live-lobby.png" });
ok((await ur.evaluate(() => document.documentElement.dir)) === "rtl", "Urdu phone is right-to-left");

// 150 voters, 8 languages
const MIX = { en: 30, hi: 30, kn: 20, te: 20, mr: 15, ur: 15, ta: 10, bn: 10 };
const voters = [];
for (const [lang, n] of Object.entries(MIX)) for (let k = 0; k < n; k++) voters.push({ id: rid(), lang });

// What the simulated room answers, per route id (k = voter index 0..149)
const SIM = {
  p1: (k) => ({ who: k < 70 ? "nocode" : "agency", time: k < 60 ? "weekend" : "6m", cost: k < 80 ? "free" : "5l" }),
  q1: (k) => ["A", "B", "C", "D"][k % 4],
  p2: (k) => (k < 100 ? "B" : "A"), //            the shortcut: right, so -10
  q3: (k) => (k < 100 ? "C" : "B"), //            right
  p3: (k) => (k < 90 ? "yes" : "notyet"), //      60%, so +12
  q4: (k) => ["A", "B", "C"][k % 3],
  q5: (k) => (k < 90 ? "A" : "B"), //             second best, so wrong: -15
  q6: (k) => (k < 110 ? { totals: "leave", names: "never", health: "tokenize", reports: "leave" } : { totals: "never", names: "tokenize", health: "leave", reports: "leave" }),
  q7: (k) => (k < 100 ? "B" : "A"), //            right
  p4: (k, sub) => [k < 100 ? "leave" : "never", k < 100 ? "never" : "leave", k < 100 ? "leave" : "tokenize"][sub], // right, right, wrong: +10
  q8: (k) => (k < 120 ? ["owner", "understands", "data"] : ["design", "features", "cost"]), // right
  q9: (k) => ["A", "B", "C"][k % 3],
  q10: (k) => ["A", "B", "C", "D"][k % 4],
  p7: (k) => (k < 75 ? "yes" : "notyet"), //      50%, so +10
};
const MIRROR = { q1: (k) => ["parked", "learning", "daily", "own"][k % 4], q6: (k) => ["yes", "no", "notsure"][k % 3], q11: (k) => ["learning", "daily", "own"][k % 3] };
// Fuel after each stop (cap 100): only the 5 scored questions and the pitstops change it
const FUEL = { p1: 100, q1: 100, p2: 90, q2: 90, q3: 90, p3: 100, q4: 100, q5: 85, q6: 85, c1: 85, q7: 85, c2: 85, p4: 95, q8: 95, p5: 100, q9: 100, p6: 100, q10: 100, p7: 100, q11: 100 };

async function phoneAnswer(p, it, sub, mirror = false) {
  const c = (sel) => p.locator(sel).first().click({ timeout: 5000 });
  await p.waitForSelector(".v-opts, .v-pipe, .v-group, .v-est, .v-word, .v-part", { timeout: 8000 });
  if (mirror) await c(`[data-a="${it.mirror.options[0].id}"]`);
  else if (it.kind === "pitstop") {
    if (it.pitType === "viewpoint") {
      for (const q of it.polls) await c(`label[for="poll-${q.id}-${q.options[2].id}"]`);
      await c('[data-act="send"]');
    } else if (it.pitType === "checkpost") await c(`[data-a="${it.rounds[sub].answer}"]`);
    else await c(`[data-a="${it.poll.options[0].id}"]`);
  } else
    switch (it.type) {
      case "estimate":
        await p.locator("#r-then_weeks").fill("12");
        await c('[data-act="send"]');
        break;
      case "choose": await c(`[data-a="${it.answer || it.options[0].id}"]`); break;
      case "tapstep": await c(`[data-a="${it.answer}"]`); break;
      case "checkpoint": await c(`[data-a="${it.answer}"]`); break;
      case "pickn":
        for (const id of it.items.filter((x) => !it.decoys.includes(x.id)).slice(0, it.n).map((x) => x.id)) await c(`[data-pick="${id}"]`);
        await c('[data-act="send"]');
        break;
      case "rank":
        for (const id of it.items.map((x) => x.id)) await c(`[data-rank="${id}"]`);
        await c('[data-act="send"]');
        break;
      case "match":
        for (const x of it.items) await c(`label[for="m-${x.id}-${it.answers[x.id]}"]`);
        await c('[data-act="send"]');
        break;
      case "wordcloud":
        await p.fill("#word", p === ur ? "Clean water tracker" : "Volunteer app");
        await c('[data-act="send"]');
        break;
      case "dualcloud":
        await p.fill("#w-build", p === ur ? "Clean water tracker" : "Volunteer app");
        if (p === ur) await p.fill("#w-never", "Decide who gets aid"); // Ladakhi phone leaves NEVER blank
        await c('[data-act="send"]');
        break;
    }
  await p.waitForSelector(".v-note.good", { timeout: 8000 });
  if (it.kind === "question" && (mirror || ["choose", "tapstep", "checkpoint"].includes(it.type))) {
    // once counted: the pick stays on screen, green with a check, nothing can be tapped again, "Vote counted ✓"
    const lock = await p.evaluate(() => ({ mine: document.querySelectorAll(".v-opt.mine, .v-toll.lifted").length, live: document.querySelectorAll(".v-opt:not(:disabled), .v-toll:not(:disabled)").length, note: !!document.querySelector(".v-locked") }));
    if (!(lock.mine === 1 && lock.live === 0 && lock.note)) lockedBad.push(`${it.id}: ${JSON.stringify(lock)}`);
  }
}

const lockedBad = [];
const key = async (k, ms = 700) => {
  await presenter.keyboard.press(k);
  await sleep(ms);
};
const curSlot = async () => (await api("/api/state")).data.slot;
const pstate = () => presenter.evaluate(() => ({ i: __ride.state.i, sub: __ride.state.sub, phase: __ride.state.phase, hurdle: __ride.state.hurdle, slot: __ride.slot(), screen: __ride.screenId(), fuel: document.querySelector("#fuelPct").textContent }));
const allSee = (slot, phase) => seen.filter(Boolean).length >= 150 && seen.every((x) => !x || (x.slot === slot && x.phase === phase));

console.log("\nThe route, stop by stop");
let lateDone = false;
let dropDone = false;
let urDropDone = false;
for (let guard = 0; guard < 220; guard++) {
  const s = await pstate();
  if (s.phase === "summary") break;
  const it = R[s.i];
  const label = `${s.screen}`;
  if (s.phase === "arrive") {
    await sleep(300);
    const st = (await api("/api/state")).data;
    ok(st.slot === it.id && st.phase === "arrive" && allSee(it.id, "arrive"), `stop ${it.stopIndex + 1} ${it.stopId}: arrival on every phone (${st.slot})`);
    // 30 phones join late (at stop 2) and land straight on the current step
    if (it.stopId === "anantapur" && !lateDone) {
      lateDone = true;
      for (let k = 150; k < 180; k++) connectSocket(k);
      await sleep(1500);
      ok(seen.slice(150).every((x) => x && x.slot === it.id && x.phase === "arrive"), "30 late joiners land on the current step");
    }
  } else if (s.phase === "card" || s.phase === "info") {
    await sleep(400);
    const st = (await api("/api/state")).data;
    ok(st.slot === it.id && st.phase === "info", `${label}: shown on phones, no vote`);
    if (it.pitType === "chai") ok(await presenter.isVisible("#timerBox"), "chai stall: 30-second timer on the projector");
    await presenter.screenshot({ path: `${OUT}live-${it.id}.png` });
  } else if (s.phase === "hurdle") {
    const shown = [];
    for (let h = 1; h <= it.hurdles.length; h++) {
      shown.push([await presenter.$$eval(".hurdles.big .hurdle", (x) => x.length), (await api("/api/state")).data.phase]);
      await key("ArrowRight", 900);
    }
    ok(shown.every(([n, ph], k) => n === k + 1 && ph === "arrive") && (await api("/api/state")).data.phase === "open", `${it.id}: one hurdle sign per Next, voting opens after the last (${JSON.stringify(shown)})`);
    continue;
  } else if (s.phase === "ask") {
    const slot = await curSlot();
    const mirror = s.screen.endsWith(".mirror");
    for (let w = 0; w < 15 && !allSee(slot, "open"); w++) await sleep(200);
    if (!allSee(slot, "open")) console.log("    debug: phones on", JSON.stringify(Object.entries(seen.reduce((a, x) => ((a[x ? `${x.slot}/${x.phase}` : "none"] = (a[x ? `${x.slot}/${x.phase}` : "none"] || 0) + 1), a), {}))));
    ok(slot === s.slot && allSee(slot, "open"), `${label}: every phone got the open step (${slot})`);
    // 20 phones drop and reconnect mid-route (at Q6); a real phone goes offline and comes back
    if (it.id === "q6" && !mirror && !dropDone) {
      dropDone = true;
      for (let k = 0; k < 20; k++) sockets[k].close();
      await sleep(800);
      for (let k = 0; k < 20; k++) { seen[k] = null; connectSocket(k); }
      await sleep(1500);
      ok(seen.slice(0, 20).every((x) => x && x.slot === slot && x.phase === "open"), "20 dropped phones reconnect onto the current step");
    }
    if (it.id === "q7" && !urDropDone) {
      urDropDone = true;
      const before = await ur.evaluate(() => localStorage.getItem("ride.voter"));
      await ur.context().setOffline(true); // no new connections or requests…
      await ur.evaluate(() => window.__vote.dropConnection()); // …and the open one drops, as on a lost signal
      await sleep(5000);
      const offlineText = await ur.textContent("#connText");
      await ur.context().setOffline(false);
      await ur.waitForFunction((sl) => window.__vote?.state?.slot === sl && document.querySelector(".v-opts"), slot, { timeout: 15000 }).catch(() => {});
      const after = await ur.evaluate(() => ({ voter: localStorage.getItem("ride.voter"), slot: window.__vote?.state?.slot }));
      const urUi = JSON.parse(await readFile(`${ROOT}public/content/ur.json`, "utf8")).ui;
      ok(offlineText === urUi.reconnecting, `Urdu phone offline shows “Reconnecting…” (${offlineText})`);
      ok(after.slot === slot && after.voter === before, "Urdu phone rejoins on the current step with the same voter id");
    }
    if (it.type === "dualcloud" && !mirror) {
      await phoneAnswer(ur, it, s.sub);
      await phoneAnswer(lad, it, s.sub);
      // 150 simulated phones: most answer both parts, some only one; 10 include a rude answer
      const BUILD = ["Clean water tracker", "Volunteer app", "Ration card helper", "Voice line for farmers", "Clean water tracker"];
      const NEVER = ["Decide who gets aid", "Replace a field visit", "Speak for the community", "Decide who gets aid"];
      const bodies = voters.map((v, k) => {
        const entries = [];
        if (k % 7 !== 3) entries.push({ part: "build", text: k % 15 === 0 ? "fuck this" : BUILD[k % BUILD.length] });
        if (k % 5 !== 2) entries.push({ part: "never", text: NEVER[k % NEVER.length] });
        return { voter: v.id, slot, lang: v.lang, entries };
      }).filter((b) => b.entries.length); // a phone with both boxes blank can't press Submit
      const res = await Promise.all(bodies.map((b) => api("/api/word", b)));
      const rude = bodies.filter((b) => b.entries.some((e) => e.text === "fuck this")).length;
      ok(res.filter((r) => r.data?.reason === "rephrase").length === rude, `dualcloud: profanity filter rejected the ${rude} rude submissions`);
      ok(res.filter((r) => r.data?.ok).length === bodies.length - rude, `dualcloud: ${bodies.length - rude} of ${bodies.length} submissions accepted (${150 - bodies.length} phones left both boxes blank)`);
      ok((await api("/api/word", bodies[1])).data?.reason === "limit", "dualcloud: one answer per part per phone");
      const st = (await api("/api/state?role=presenter")).data;
      ok(st.tally.n === bodies.length - rude + 2, `Q11 counts ${st.tally.n} phones (${bodies.length - rude} accepted + 2 real phones), including the 60 that already answered Q2`);
      const raw = (await admin({ action: "words" })).data.words;
      ok(raw.length && raw.every((w) => w.slot === slot && (w.part === "build" || w.part === "never")), `Q11 queue holds only Q11 entries (${raw.length}, each tagged BUILD or NEVER; Q2's unhandled answers expired)`);
      await sleep(2500);
      const queue = await mod.$$eval("#queue .queue li", (n) => n.map((li) => !!li.querySelector(".ptag")));
      ok(queue.length > 0 && queue.every(Boolean), `moderator queue at Q11 shows only Q11 entries (${queue.length}, all tagged)`);
      await mod.screenshot({ path: OUT + "mod-wordcloud.png", fullPage: true });
      for (let n = 0; n < 4; n++) {
        await mod.locator('[data-s="approved"]').first().click();
        await sleep(700);
      }
      const pending = raw.filter((w) => w.status === "pending");
      for (const w of pending.slice(4, 60)) await admin({ action: "word", id: w.id, status: "approved" });
      await sleep(1800);
      const words = (await api("/api/state?role=presenter")).data.words;
      const cloud = await presenter.evaluate(() => ({ build: document.querySelector("#cloud-build").textContent, never: document.querySelector("#cloud-never").textContent, counter: document.querySelector("#ansCount")?.dataset.target }));
      const bW = words.filter((w) => w.part === "build").map((w) => w.text);
      const nW = words.filter((w) => w.part === "never").map((w) => w.text);
      ok(bW.length && nW.length && bW.every((t) => cloud.build.includes(t)) && nW.every((t) => cloud.never.includes(t)), `both clouds fill from the queue (BUILD ${bW.length}, NEVER ${nW.length}), each in its own cloud`);
      ok(Number(cloud.counter) === st.tally.n, `"answers in" counter shows ${cloud.counter}`);
    } else if (it.type === "wordcloud" && !mirror) {
      await phoneAnswer(ur, it, s.sub);
      await phoneAnswer(lad, it, s.sub);
      const texts = ["Clean water tracker", "Volunteer app", "Clean water tracker", "Voice line for farmers", "fuck this", "Ration card helper"];
      const res = await Promise.all(voters.slice(0, 60).map((v, k) => api("/api/word", { voter: v.id, slot, text: texts[k % texts.length], lang: v.lang })));
      ok(res.filter((r) => r.data?.reason === "rephrase").length === 10, "word cloud: profanity filter rejected the 10 rude answers");
      await sleep(2500);
      for (let n = 0; n < 4; n++) {
        await mod.locator('[data-s="approved"]').first().click();
        await sleep(700);
      }
      await sleep(1200);
      ok(/Clean water tracker|Volunteer app|Voice line/.test(await presenter.textContent("#cloud")), "approved words appear on the projector");
      // the rest of Q2's queue is left unhandled on purpose: it must not show up at Q11
    } else {
      await phoneAnswer(ur, it, s.sub, mirror);
      await phoneAnswer(lad, it, s.sub, mirror);
      const answer = (v, k) => (mirror ? MIRROR[it.id](k) : SIM[it.id](k, s.sub));
      const t0 = Date.now();
      const res = await Promise.all(voters.map((v, k) => api("/api/vote", { voter: v.id, slot, answer: answer(v, k), lang: v.lang })));
      ok(res.every((r) => r.status === 200 && r.data.ok), `${label}: 150 answers accepted in ${Date.now() - t0} ms`);
      const st = (await api("/api/state?role=presenter")).data;
      ok(st.tally.n === 152, `${label}: counted ${st.tally.n} of 152 (150 + 2 phones), once each, under step id ${slot}`);
    }
    await sleep(500);
    await presenter.screenshot({ path: `${OUT}live-${s.screen.replace(/[>:]/g, "-")}-open.png` });
    const fuelBefore = await presenter.textContent("#fuelPct");
    await key("r", it.type === "dualcloud" ? 2400 : 1200);
    if ((await pstate()).phase === "ask") await key("r", 1200);
    await presenter.screenshot({ path: `${OUT}live-${s.screen.replace(/[>:]/g, "-")}-reveal.png` });
    if (mirror) {
      ok((await presenter.textContent("#fuelPct")) === fuelBefore, `${label}: no fuel change`);
      if (it.mirror.compareWith) ok((await presenter.$$(".compare .cmp-cell")).length === it.mirror.options.length * 2, `${label}: Today vs. in 6 months shown`);
    }
    if (it.type === "dualcloud" && !mirror) ok((await presenter.textContent(".final-sign")).includes("Technology is not the destination."), "Q11 reveal: clouds settle, then the final signboard");
    if (it.revealAfter) {
      const st = (await api("/api/state")).data;
      ok(st.phase === "closed" && allSee(slot, "closed"), `${label}: answers held until ${it.revealAfter.toUpperCase()} (phones see "closed")`);
      ok((await presenter.$$eval(".dsign.right", (x) => x.length)) === 0, `${label}: no right answers marked on the projector yet`);
    }
  } else if (s.phase === "reveal" && s.screen.includes(">reveal:")) {
    const vp = R.find((r) => r.revealAfter === it.id);
    const st = (await api("/api/state")).data;
    ok(st.slot === s.slot && st.phase === "reveal" && (await presenter.$$eval(".dsign.right", (x) => x.length)) === vp.polls.length && !(await presenter.isVisible(".signboard .q-en")),
      `after ${it.id.toUpperCase()}: viewpoint answers revealed (${s.slot}), Q1's question not shown again`);
  }
  // Next (riding to the next stop when the stop is done); fuel is checked when a step is left
  const leaving = ["reveal", "info", "card"].includes(s.phase);
  await key("ArrowRight", 700);
  const after = await pstate();
  if (after.phase === "arrive" || (await presenter.evaluate(() => document.querySelector("#bike").classList.contains("riding")))) await sleep(3000);
  if (leaving && after.i !== s.i && FUEL[it.id] != null) ok(s.fuel === `${FUEL[it.id]}%`, `${it.id}: fuel ${s.fuel}`);
}
ok(!lockedBad.length, `phones lock after voting: the pick stays green with a check ${lockedBad.join(" | ")}`);
await sleep(1500);
const walked = await presenter.evaluate(() => ({ screens: __ride.stats.screens, arrivals: __ride.stats.arrivals }));
ok(walked.screens.length === new Set(walked.screens).size, `forward walk: ${walked.screens.length} screens, none repeated`);
ok(walked.arrivals.length === en.stops.length && walked.arrivals.every((a, k) => !k || a.km > walked.arrivals[k - 1].km), `each stop arrived once, km only increases (${walked.arrivals.map((a) => a.km).join(" → ")})`);
console.log("\nFinale");
const stats = await presenter.$$eval(".stat b", (n) => n.map((x) => x.textContent));
ok(stats[0] === "4/5" && stats[1] === "100%" && stats[2] === "2,100", `summary: ${stats.join(" · ")}`);
ok(Number(stats[3]) >= 6, `${stats[3]} languages played (8 simulated + the Ladakhi phone)`);
ok((await presenter.$$(".passport .stamp")).length === 7, "travel log has all 7 stamps");
await presenter.screenshot({ path: OUT + "live-summary.png" });

// ---------------------------------------------------------------- fallback (network drop on the presenter laptop)
console.log("\nFallback");
await desk.setOffline(true);
await presenter.evaluate(() => window.__ride.live.ws?.close());
const tDrop = Date.now();
await presenter.waitForFunction(() => window.__ride.live.on === false, null, { timeout: 15000 }).catch(() => {});
const dropSecs = (Date.now() - tDrop) / 1000;
ok(!(await presenter.evaluate(() => window.__ride.live.on)) && dropSecs < 8, `falls back to Host Mode when the backend is unreachable (${dropSecs.toFixed(1)} s)`);
ok((await presenter.textContent("#barMode")).includes("Live lost"), "presenter bar shows the Host Mode badge");
await desk.setOffline(false);
await presenter.waitForSelector("#btnLive:not(.hidden)", { timeout: 15000 }).catch(() => {});
ok(await presenter.isVisible("#btnLive"), "server back: “Return to Live” offered");
const posBefore = await pstate();
await presenter.click("#btnLive");
await presenter.waitForFunction(() => window.__ride.live.on === true, null, { timeout: 10000 }).catch(() => {});
const posAfter = await pstate();
ok((await presenter.evaluate(() => window.__ride.live.on)) && posAfter.screen === posBefore.screen, `back to Live at the same position (${posAfter.screen})`);
for (const w of sockets) w.close();

// ---------------------------------------------------------------- every language on a phone
console.log("\nEvery language on a phone (390×844): translation, script font, direction, accessibility");
const FONT = { hi: "RideDeva", mr: "RideDeva", ne: "RideDeva", kn: "RideKnda", te: "RideTelu", bn: "RideBeng", as: "RideBeng", ta: "RideTaml", lad: "RideTibt", ur: "RideUrdu" };
const LANGS = ["en", "hi", "kn", "te", "mr", "ur", "lad", "ne", "as", "bn", "ta"];
const SCREENS = [["q8", "pickn"], ["q6", "match"], ["q2", "wordcloud"], ["q3", "choose"], ["q7", "choose"], ["q5", "choose"], ["q1", "choose"], ["q11", "dualcloud"]];
for (const code of LANGS) {
  const file = code === "en" ? null : JSON.parse(await readFile(`${ROOT}public/content/${code}.json`, "utf8"));
  const p = await phone(code, `lang-${code}`);
  let allOk = true;
  const issues = [];
  for (const [id] of SCREENS) {
    const idx = R.findIndex((r) => r.id === id);
    await admin({ action: "set", slot: id, phase: "open" });
    await p.waitForFunction((s) => window.__vote?.state?.slot === s, id, { timeout: 8000 });
    await sleep(600);
    const info = await p.evaluate((fam) => ({
      q: document.querySelector(".v-q")?.textContent,
      dir: document.documentElement.dir,
      font: fam ? [...document.fonts].some((f) => f.family.replace(/"/g, "") === fam && f.status === "loaded") : true,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...document.querySelectorAll("button, input[type=range], .v-radio label")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 47.5).length,
      signs: [...document.querySelectorAll(".v-opt, .v-toll, .signs .v-radio label, .lanes .v-radio label")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 63.5).length,
    }), FONT[code]);
    const want = code === "en" ? R[idx].question : file.route[id].question;
    await p.addScriptTag({ content: AXE });
    const axe = await p.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }).then((r) => r.violations.map((v) => `${v.id}(${v.nodes.length})`)));
    const good = info.q === want && info.font && !info.overflow && info.dir === (code === "ur" ? "rtl" : "ltr") && info.small === 0 && info.signs === 0 && axe.length === 0;
    if (!good) issues.push(`${id}: ${JSON.stringify({ q: info.q === want, font: info.font, overflow: info.overflow, dir: info.dir, small: info.small, signs: info.signs, axe })}`);
    allOk &&= good;
    await p.screenshot({ path: `${OUT}lang-${code}-${id}.png`, fullPage: true });
  }
  ok(allOk, `${code}: ${FONT[code] || "Latin"} loaded, dir ok, no sideways scroll, buttons ≥ 48px, answer signs ≥ 64px, 0 axe violations${issues.length ? "\n      " + issues.join("\n      ") : ""}`);
  await p.context().close();
}
const pick = await browser.newContext({ ...devices["iPhone 13"] });
const pp = await pick.newPage();
await pp.goto(BASE + "/v");
await pp.waitForSelector(".v-lang-btn");
ok((await pp.$$(".v-lang-btn")).length === 12, "language picker: 11 languages + Other");
await pp.addScriptTag({ content: AXE });
const axePick = await pp.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }).then((r) => r.violations.map((v) => v.id)));
ok(axePick.length === 0, `language picker: 0 axe violations ${axePick.join(",")}`);
await pp.screenshot({ path: OUT + "lang-picker.png" });
await pick.close();

// ---------------------------------------------------------------- projector with the longest translations
console.log("\nProjector 1920×1080 with every regional language (longest translations)");
const proj = await desk.newPage();
watch(proj, "projector-rl");
for (const code of LANGS.filter((c) => c !== "en")) {
  const bad = [];
  await proj.goto(`${BASE}/?mode=host&rl=${code}`);
  for (let i = 0; i < R.length; i++) {
    const it = R[i];
    const phases = it.kind === "card" || it.kind === "intro" ? ["card"] : it.kind === "question" ? ["ask", "reveal"] : ["petrol", "landslide", "checkpost", "viewpoint"].includes(it.pitType) ? ["ask"] : ["info"];
    for (const phase of phases) {
      await proj.evaluate(([i, phase]) => localStorage.setItem("ride.state.v4", JSON.stringify({ i, sub: 0, phase, manual: {}, final: {}, stamps: {}, mode: "host" })), [i, phase]);
      await proj.reload();
      await proj.waitForFunction(() => window.__ride?.state);
      await sleep(650); // band transition + refit
      const m = await proj.evaluate(() => {
        const scene = document.querySelector("#scene");
        const inner = scene.firstElementChild;
        const q = document.querySelector(".q-en");
        const kids = inner ? [...inner.querySelectorAll(".ask-main > *, :scope > *")] : [];
        const bottom = Math.max(0, ...kids.map((k) => k.getBoundingClientRect().bottom));
        return { over: bottom > scene.getBoundingClientRect().bottom + 2, qpx: q ? parseFloat(getComputedStyle(q).fontSize) : 99, rl: !!document.querySelector(".rl") };
      });
      if (m.over || m.qpx < 40 || !m.rl) bad.push(`${it.id}/${phase}${m.over ? " overflows" : ""}${m.qpx < 40 ? ` question ${m.qpx}px` : ""}${!m.rl ? " no regional line" : ""}`);
    }
  }
  ok(!bad.length, `${code}: every screen fits, question ≥ 40px, regional line present${bad.length ? " — " + bad.join(", ") : ""}`);
}
await proj.evaluate((i) => localStorage.setItem("ride.state.v4", JSON.stringify({ i, sub: 0, phase: "ask", manual: {}, final: {}, stamps: {}, mode: "host" })), R.findIndex((r) => r.id === "q10"));
await proj.goto(`${BASE}/?mode=host`);
await sleep(800);
const first = await proj.$eval(".signboard .rl", (e) => e.lang);
await sleep(6600);
const second = await proj.$eval(".signboard .rl", (e) => e.lang);
ok(first !== second && [first, second].sort().join() === "hi,ur", `Agra alternates Hindi and Urdu every 6 s (${first} → ${second})`);
await proj.evaluate((i) => localStorage.setItem("ride.state.v4", JSON.stringify({ i, sub: 0, phase: "ask", manual: {}, final: {}, stamps: {}, mode: "host" })), R.findIndex((r) => r.id === "q11"));
await proj.reload();
await sleep(800);
const seenLangs = new Set();
for (let n = 0; n < 7; n++) {
  seenLangs.add(await proj.$eval(".signboard .rl", (e) => e.lang));
  await sleep(4100);
}
ok(seenLangs.size >= 6, `final question cycles through the audience languages every 4 s (${[...seenLangs].join(", ")})`);

ok(errors.length === 0, `no JS errors ${errors.slice(0, 5).join(" | ")}`);
await browser.close();
await admin({ action: "reset" });
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
