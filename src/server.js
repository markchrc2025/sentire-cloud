import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { checkAll } from "./status.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8080);
const INTERVAL = Number(process.env.CHECK_INTERVAL_SECONDS || 60) * 1000;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json" };

const config = JSON.parse(await readFile(join(ROOT, "services.json"), "utf8"));
let latest = { checkedAt: null, products: config.products, platform: config.platform, allUp: null };

async function refresh() {
  try {
    latest = await checkAll(config);
  } catch (e) {
    console.error("status check failed", e);
  }
}

export function handler(getLatest) {
  return async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    if (url.pathname === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(getLatest()));
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) {
      res.writeHead(400);
      return res.end();
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await refresh();
  setInterval(refresh, INTERVAL);
  createServer(handler(() => latest)).listen(PORT, () => console.log(`Sentire Cloud console on :${PORT}`));
}
