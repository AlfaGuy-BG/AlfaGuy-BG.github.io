// Minimal static server for the tests (no dependencies). Serves ./site on PORT (default 4173).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";

const ROOT = join(process.cwd(), "site");
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(ROOT, path.endsWith("/") ? path + "index.html" : path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end("forbidden"); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Serving site/ on port ${PORT}`));
