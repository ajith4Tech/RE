// Zero-dependency static server for HOST MODE (works fully offline).
// Usage:  node tools/serve.mjs [port]      then open the printed URL (default http://localhost:4321)
// If the port is busy (e.g. Jenkins on 8080), the next free port is used automatically.
// /api/state answers { hostOnly: true }, so the projector and moderator view know there is no Live
// server to wait for (and the browser console stays clean).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const firstPort = Number(process.argv[2] || process.env.PORT || 4321);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/api/state") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return res.end(JSON.stringify({ hostOnly: true }));
  }
  if (path === "/") path = "/index.html";
  if (path === "/v" || path === "/v/" || path === "/vote") path = "/vote.html";
  if (path === "/moderator" || path === "/moderator/") path = "/moderator.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

let port = firstPort;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && port < firstPort + 20) {
    console.log(`  Port ${port} is busy, trying ${port + 1}…`);
    server.listen(++port);
  } else {
    console.error(err.message);
    process.exit(1);
  }
});
server.on("listening", () => {
  console.log(`\n  The Ride (Host Mode) → http://localhost:${port}\n  Press F in the browser for fullscreen. Ctrl+C to stop.\n`);
});
server.listen(port);
