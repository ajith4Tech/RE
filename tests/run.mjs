// End-to-end test for Live Vote mode against `wrangler dev` (or a deployed Worker).
//   npm run dev                (ADMIN_PIN=1234 in .dev.vars)
//   node tests/run.mjs [baseUrl] [pin]
// - 150 simulated voters in 8 languages answer every question format and every pitstop
// - real phone pages in Urdu (right-to-left) and Ladakhi (Tibetan) answer through the UI
// - word cloud: profanity filter + moderator approval queue
// - every language on a phone screen: translation, script font, direction, axe accessibility checks
// - projector at 1920×1080 with every language as the regional line (longest translations)
// - palette contrast ratios, and the automatic fallback to Host Mode
import { chromium, devices } from "playwright";
import { readFile } from "node:fs/promises";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const PIN = process.argv[3] || process.env.ADMIN_PIN || "1234";
const OUT = new URL("./screenshots/", import.meta.url).pathname;
const ROOT = new URL("../", import.meta.url).pathname;
const AXE = await readFile(ROOT + "node_modules/axe-core/axe.min.js", "utf8");
const en = JSON.parse(await readFile(ROOT + "public/content/en.json", "utf8"));
const R = en.route;

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
ok((await api("/api/vote", { voter: rid(), slot: "0", answer: "A" })).status === 409, "vote refused when nothing is open");
ok((await api("/api/vote", { voter: rid(), slot: "0", answer: { a: "<b>" } })).status === 400, "malformed answer rejected");

// ---------------------------------------------------------------- browsers
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const errors = [];
const watch = (p, who) => p.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));

const desk = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const presenter = await desk.newPage();
watch(presenter, "presenter");
await presenter.goto(BASE + "/");
await presenter.evaluate(() => localStorage.clear());
await presenter.goto(BASE + "/?mode=live");
await presenter.waitForSelector("#modalInput");
await presenter.fill("#modalInput", PIN);
await presenter.keyboard.press("Enter");
await presenter.waitForFunction(() => window.__ride?.live.on === true);
await sleep(700);
console.log("\nProjector (Live, 1920×1080)");
ok(await presenter.isVisible("#qrBig svg"), "intro shows the QR code");

const modCtx = await browser.newContext({ ...devices["iPhone 13"] });
const mod = await modCtx.newPage();
watch(mod, "moderator");
await mod.goto(BASE + "/moderator");
await mod.waitForSelector("#pin");
await mod.fill("#pin", PIN);
await mod.click(".gate button");
await sleep(1200);

const sockets = [];
const seen = new Array(150).fill(null);
for (let k = 0; k < 150; k++) {
  const w = new WebSocket(BASE.replace(/^http/, "ws") + "/api/ws?role=voter");
  w.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data); if (m.type === "state") seen[k] = m.state; } catch {}
  };
  sockets.push(w);
}
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
ok((await ur.evaluate(() => document.documentElement.dir)) === "rtl", "Urdu phone is right-to-left");

// 150 voters, 8 languages
const MIX = { en: 30, hi: 30, kn: 20, te: 20, mr: 15, ur: 15, ta: 10, bn: 10 };
const voters = [];
for (const [lang, n] of Object.entries(MIX)) for (let k = 0; k < n; k++) voters.push({ id: rid(), lang });

// What the simulated room answers, per route id (k = voter index 0..149)
const SIM = {
  q1: (k) => ({ then_weeks: 10 + (k % 10), then_cost: 100000 + (k % 5) * 20000, now_weeks: k % 3, now_cost: 1000 + (k % 4) * 1000 }),
  q2: (k) => (k < 90 ? "s2" : "s4"),
  p1: (k) => (k < 90 ? "yes" : "notyet"),
  q3: (k) => (k < 80 ? "A" : "B"),
  p2: (k) => (k < 100 ? "A" : "C"),
  q4: (k) => (k < 100 ? "g4" : "g2"),
  p3: (k) => ({ who: k < 70 ? "nocode" : "agency", time: k < 60 ? "weekend" : "6m", cost: k < 80 ? "free" : "5l" }),
  q5: (k) => (k < 90 ? "D" : "A"),
  q6: (k) => (k < 120 ? ["login", "locations", "keys", "colours"] : ["dummy", "phone", "eyes", "domain"]),
  q7: (k) => (k < 110 ? ["faq", "attendance", "donors", "loans"] : ["attendance", "faq", "loans", "donors"]),
  p5: (k, sub) => [k < 100 ? "cloud" : "dont", k < 100 ? "dont" : "cloud", k < 100 ? "offline" : "cloud"][sub],
  q8: (k) => (k < 110 ? { songs: "cloud", stories: "offline", sacred: "dont", names: "offline" } : { songs: "offline", stories: "cloud", sacred: "offline", names: "cloud" }),
  q9: (k) => (k < 100 ? "C" : "B"),
  p7: (k) => (k < 75 ? "yes" : "notyet"),
};
// Fuel after each item, given those answers (cap 100)
const FUEL = { q2: 100, p1: 100, q3: 85, p2: 75, q4: 75, p3: 75, q5: 75, q6: 60, p4: 65, q7: 65, p5: 75, q8: 75, p6: 75, q9: 75, p7: 85, q10: 85 };

async function phoneAnswer(p, it, sub) {
  const c = (sel) => p.locator(sel).first().click({ timeout: 5000 });
  await p.waitForSelector(".v-opts, .v-pipe, .v-group, .v-est, .v-word", { timeout: 8000 });
  if (it.kind === "pitstop") {
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
      case "choose": await c(`[data-a="${it.answer}"]`); break;
      case "tapstep": await c(`[data-a="${it.answer}"]`); break;
      case "checkpoint": await c(`[data-a="${it.answer}"]`); break;
      case "pickn":
        for (const id of ["login", "locations", "keys", "dummy"]) await c(`[data-pick="${id}"]`);
        await c('[data-act="send"]');
        break;
      case "rank":
        for (const id of ["faq", "attendance", "donors", "loans"]) await c(`[data-rank="${id}"]`);
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
    }
  await p.waitForSelector(".v-note.good", { timeout: 8000 });
}

const key = async (k, ms = 700) => {
  await presenter.keyboard.press(k);
  await sleep(ms);
};
const curSlot = async () => (await api("/api/state")).data.slot;

console.log("\nThe route");
await key("ArrowRight", 900); // arrive at Bengaluru
for (let i = 0; i < R.length; i++) {
  const it = R[i];
  if (i > 0) await key("ArrowRight", 3200);
  const label = `${it.id} ${it.kind === "question" ? it.type : it.pitType}`;
  if (it.kind === "pitstop" && ["mechanic", "chai"].includes(it.pitType)) {
    await key("ArrowRight", 900);
    ok((await api("/api/state")).data.phase === "info", `${label}: board shown on phones, no vote`);
    if (it.pitType === "chai") ok(await presenter.isVisible("#timerBox"), "chai stall: 30-second timer on the projector");
    await presenter.screenshot({ path: `${OUT}live-${it.id}.png` });
    continue;
  }
  await key("ArrowRight", 1000); // open
  const subs = it.pitType === "viewpoint" ? it.showcases.length : it.pitType === "checkpost" ? it.rounds.length : 1;
  for (let sub = 0; sub < subs; sub++) {
    if (sub) await key("ArrowRight", 1000);
    const slot = await curSlot();
    const want = it.pitType === "viewpoint" || it.pitType === "checkpost" ? `${i}.${sub}` : `${i}`;
    if (slot !== want) console.log("    debug:", slot, "expected", want, JSON.stringify(await presenter.evaluate(() => ({ i: __ride.state.i, sub: __ride.state.sub, phase: __ride.state.phase, live: __ride.live.on }))));
    ok(seen.every((s) => s && s.slot === slot && s.phase === "open"), `${label}${subs > 1 ? ` #${sub + 1}` : ""}: all 150 sockets got the open step (${slot})`);
    await phoneAnswer(ur, it, sub);
    await phoneAnswer(lad, it, sub);
    if (it.type === "wordcloud") {
      const texts = ["Clean water tracker", "Volunteer app", "Clean water tracker", "Voice line for farmers", "fuck this", "Ration card helper"];
      const res = await Promise.all(voters.slice(0, 60).map((v, k) => api("/api/word", { voter: v.id, slot, text: texts[k % texts.length], lang: v.lang })));
      ok(res.filter((r) => r.data?.reason === "rephrase").length === 10, "profanity filter rejected the 10 rude answers");
      await sleep(2500);
      await mod.screenshot({ path: OUT + "mod-wordcloud.png", fullPage: true });
      // moderator approves the first four waiting entries
      for (let n = 0; n < 4; n++) {
        await mod.locator('[data-s="approved"]').first().click();
        await sleep(700);
      }
      await sleep(1200);
      const cloud = await presenter.textContent("#cloud");
      ok(/Clean water tracker|Volunteer app|Voice line/.test(cloud), "approved words appear on the projector");
    } else {
      const t0 = Date.now();
      const res = await Promise.all(voters.map((v, k) => api("/api/vote", { voter: v.id, slot, answer: SIM[it.id](k, sub), lang: v.lang })));
      ok(res.every((r) => r.status === 200 && r.data.ok), `${label}: 150 answers accepted in ${Date.now() - t0} ms`);
      const st = (await api("/api/state?role=presenter")).data;
      ok(st.tally.n === 152, `${label}: counted ${st.tally.n} of 152 (150 + 2 phones), once each`);
    }
    await sleep(500);
    if (sub === 0) await presenter.screenshot({ path: `${OUT}live-${it.id}-open.png` });
    if (sub === 0 && i < 4) await ur.screenshot({ path: `${OUT}phone-ur-${it.id}.png` });
    await key("r", 1200);
    if (sub === 0) await presenter.screenshot({ path: `${OUT}live-${it.id}-reveal.png` });
    if (sub === 0) await lad.screenshot({ path: `${OUT}phone-lad-${it.id}-reveal.png` });
  }
  if (FUEL[it.id] != null) ok((await presenter.textContent("#fuelPct")) === `${FUEL[it.id]}%`, `${label}: fuel ${FUEL[it.id]}%`);
}
await key("ArrowRight", 2000);
console.log("\nFinale");
const stats = await presenter.$$eval(".stat b", (n) => n.map((x) => x.textContent));
ok(stats[0] === "6/8" && stats[1] === "85%" && stats[2] === "2,100", `summary: ${stats.join(" · ")}`);
ok(stats[3] === "9", "9 languages played (8 simulated + Ladakhi phone)");
ok((await presenter.$$(".passport .stamp")).length === 7, "travel log has all 7 stamps");
await presenter.screenshot({ path: OUT + "live-summary.png" });

// ---------------------------------------------------------------- fallback
console.log("\nFallback");
await desk.setOffline(true);
await presenter.evaluate(() => window.__ride.live.ws?.close());
const tDrop = Date.now();
await presenter.waitForFunction(() => window.__ride.live.on === false, null, { timeout: 15000 }).catch(() => {});
ok(!(await presenter.evaluate(() => window.__ride.live.on)), `falls back to Host Mode when the backend is unreachable (${((Date.now() - tDrop) / 1000).toFixed(1)} s)`);
await desk.setOffline(false);
for (const w of sockets) w.close();

// ---------------------------------------------------------------- every language on a phone
console.log("\nEvery language on a phone (390×844): translation, script font, direction, accessibility");
const FONT = { hi: "RideDeva", mr: "RideDeva", ne: "RideDeva", kn: "RideKnda", te: "RideTelu", bn: "RideBeng", as: "RideBeng", ta: "RideTaml", lad: "RideTibt", ur: "RideUrdu" };
const LANGS = ["en", "hi", "kn", "te", "mr", "ur", "lad", "ne", "as", "bn", "ta"];
const SCREENS = [["q6", "pickn"], ["q8", "match"], ["q1", "estimate"], ["q4", "checkpoint"]];
for (const code of LANGS) {
  const file = code === "en" ? null : JSON.parse(await readFile(`${ROOT}public/content/${code}.json`, "utf8"));
  const p = await phone(code, `lang-${code}`);
  let allOk = true;
  const issues = [];
  for (const [id] of SCREENS) {
    const idx = R.findIndex((r) => r.id === id);
    await admin({ action: "set", slot: String(idx), phase: "open" });
    await p.waitForFunction((s) => window.__vote?.state?.slot === s, String(idx), { timeout: 8000 });
    await sleep(600);
    const info = await p.evaluate((fam) => ({
      q: document.querySelector(".v-q")?.textContent,
      dir: document.documentElement.dir,
      font: fam ? [...document.fonts].some((f) => f.family.replace(/"/g, "") === fam && f.status === "loaded") : true,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...document.querySelectorAll("button, input[type=range], .v-radio label")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 47.5).length,
    }), FONT[code]);
    const want = code === "en" ? R[idx].question : file.route[id].question;
    await p.addScriptTag({ content: AXE });
    const axe = await p.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }).then((r) => r.violations.map((v) => `${v.id}(${v.nodes.length})`)));
    const good = info.q === want && info.font && !info.overflow && info.dir === (code === "ur" ? "rtl" : "ltr") && info.small === 0 && axe.length === 0;
    if (!good) issues.push(`${id}: ${JSON.stringify({ q: info.q === want, font: info.font, overflow: info.overflow, dir: info.dir, small: info.small, axe })}`);
    allOk &&= good;
    await p.screenshot({ path: `${OUT}lang-${code}-${id}.png`, fullPage: true });
  }
  ok(allOk, `${code}: ${FONT[code] || "Latin"} loaded, dir ok, no sideways scroll, buttons ≥ 48px, 0 axe violations${issues.length ? "\n      " + issues.join("\n      ") : ""}`);
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
  await proj.goto(`${BASE}/?rl=${code}`);
  for (let i = 0; i < R.length; i++) {
    const it = R[i];
    const phases = it.kind === "question" ? ["ask", "reveal"] : ["petrol", "landslide", "checkpost", "viewpoint"].includes(it.pitType) ? ["ask"] : ["info"];
    for (const phase of phases) {
      await proj.evaluate(([i, phase]) => localStorage.setItem("ride.state.v3", JSON.stringify({ i, sub: 0, phase, manual: {}, final: {}, stamps: {}, mode: "host" })), [i, phase]);
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
await proj.evaluate(() => localStorage.setItem("ride.state.v3", JSON.stringify({ i: 3, sub: 0, phase: "ask", manual: {}, final: {}, stamps: {}, mode: "host" })));
await proj.goto(`${BASE}/`);
await sleep(800);
const first = await proj.$eval(".signboard .rl", (e) => e.lang);
await sleep(6600);
const second = await proj.$eval(".signboard .rl", (e) => e.lang);
ok(first !== second && [first, second].sort().join() === "te,ur", `Hyderabad alternates Telugu and Urdu every 6 s (${first} → ${second})`);
await proj.evaluate(() => localStorage.setItem("ride.state.v3", JSON.stringify({ i: 16, sub: 0, phase: "ask", manual: {}, final: {}, stamps: {}, mode: "host" })));
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
