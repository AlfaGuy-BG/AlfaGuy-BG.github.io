// Renders the link preview card (tools/og/card.html) to site/og.png, 1200x627.
//   npm run og            (after npm run fonts; then look at site/og.png before committing)
// The ladybug is live in the card; the shot is taken at a fixed moment of its demo run.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, normalize, extname, sep } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const TYPES = { ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".js": "text/javascript" };
const AT_MS = Number(process.env.OG_AT_MS) || 5200;   // 5.2 s into the demo: "Searching Jira"

const server = createServer(async (req, res) => {
  try {
    const file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 627 }, deviceScaleFactor: 1 });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/tools/og/card.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(AT_MS);
  if (failed.length) throw new Error(`card resources failed (run npm run fonts?):\n${failed.join("\n")}`);
  await page.screenshot({ path: "site/og.png" });
  const v = await stampVersion();
  console.log(`site/og.png written (1200x627), og:image version ${v}. Look at it before committing.`);
} finally {
  await browser.close();
  server.close();
}

// LinkedIn and others cache preview images by URL: a new image needs a new URL.
// The version is the first 8 hex digits of the PNG's SHA-256, so it changes exactly when the image does.
async function stampVersion() {
  const v = createHash("sha256").update(await readFile("site/og.png")).digest("hex").slice(0, 8);
  const html = await readFile("site/index.html", "utf8");
  const re = /(<meta property="og:image" content="https:\/\/alfaguy-bg\.github\.io\/og\.png)(\?v=[0-9a-f]+)?(">)/;
  if (!re.test(html)) throw new Error("og:image meta tag not found in site/index.html");
  await writeFile("site/index.html", html.replace(re, `$1?v=${v}$3`));
  return v;
}
