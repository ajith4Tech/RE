// The Ride on the office Wi-Fi: keeps the Live server up and the join link pointed at this laptop.
//   node tools/lan.mjs            (or: npm run lan)
// - Runs `wrangler dev` on every network interface (port 8787 by default, PORT to change it).
// - Restarts it if it exits, or if it stops answering /api/state for ~45 s (a stuck server).
// - Every 10 s, finds this laptop's current Wi-Fi/Ethernet address and writes public/lan.json. The projector reads
//   it and puts that address in the QR code, so the join link stays right when the Wi-Fi hands out a new address.
// Open the projector at http://localhost:8787/ on this laptop: that address never changes.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const LAN_FILE = new URL("../public/lan.json", import.meta.url);
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

/** This laptop's address on the local network: Wi-Fi first, then Ethernet; never Docker, VPN or bridges. */
function lanIp() {
  const nets = networkInterfaces();
  const rank = (name) => (/^(wl|wlan|wifi)/i.test(name) ? 0 : /^(en|eth)/i.test(name) ? 1 : 9);
  const found = [];
  for (const [name, list] of Object.entries(nets)) {
    if (/^(docker|br-|veth|virbr|cni|flannel|tun|tap|lo|zt|tailscale|wg)/i.test(name)) continue;
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) found.push({ name, ip: a.address, r: rank(name) });
  }
  found.sort((a, b) => a.r - b.r);
  return found[0]?.ip || null;
}

let current = null;
try { current = JSON.parse(readFileSync(LAN_FILE, "utf8")).ip; } catch {}
function updateLan() {
  const ip = lanIp();
  if (!ip || ip === current) return;
  current = ip;
  writeFileSync(LAN_FILE, JSON.stringify({ ip, port: PORT, url: `http://${ip}:${PORT}` }) + "\n");
  log(`Wi-Fi address is now ${ip} → phones join at http://${ip}:${PORT}/v`);
}

let child = null;
let fails = 0;
let stopping = false;
function start() {
  log(`Starting the Live server on port ${PORT}…`);
  child = spawn("npx", ["wrangler", "dev", "--ip", "0.0.0.0", "--port", String(PORT)], { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, CI: "1" } });
  fails = 0;
  child.on("exit", (code) => {
    child = null;
    if (stopping) return;
    log(`The server stopped (code ${code}). Restarting in 3 s.`);
    setTimeout(start, 3000);
  });
}
async function health() {
  if (!child) return;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/state`, { signal: AbortSignal.timeout(5000) });
    fails = r.ok ? 0 : fails + 1;
  } catch {
    fails++;
  }
  if (fails >= 3) {
    log("The server isn't answering. Restarting it.");
    fails = 0;
    child.kill("SIGTERM");
    setTimeout(() => child?.kill("SIGKILL"), 5000);
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; child?.kill("SIGTERM"); setTimeout(() => process.exit(0), 1500); });

updateLan();
start();
setInterval(updateLan, 10000);
setTimeout(() => setInterval(health, 15000), 30000); // give it time to boot first
