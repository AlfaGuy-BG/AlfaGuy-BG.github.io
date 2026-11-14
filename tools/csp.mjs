// Content Security Policy for the static pages, kept in a <meta> tag (GitHub Pages cannot send headers).
// Inline <script> and <style> blocks are allowed by their SHA-256 hashes, nothing else inline runs.
//
//   node tools/csp.mjs          rewrite the CSP in every page after editing a script or style
//   node tools/csp.mjs --check  exit 1 if any page's CSP is missing or out of date (used by the tests)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PAGES = {
  "site/index.html": { "font-src": "'self'", "img-src": "'self' data:", "frame-src": "'self'" },
  "site/ladybug.html": { "img-src": "data: blob:" },
};

const META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;

export function inlineBlocks(html, tag) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  return [...html.matchAll(re)].filter((m) => !/\ssrc=/.test(m[1] || "")).map((m) => m[2]);
}

const sha = (s) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

export function policyFor(html, extra = {}) {
  const d = {
    "default-src": "'none'",
    "script-src": inlineBlocks(html, "script").map(sha).join(" ") || "'none'",
    "style-src": inlineBlocks(html, "style").map(sha).join(" ") || "'none'",
    "connect-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'",
    ...extra,
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v}`).join("; ");
}

export function withPolicy(html, extra) {
  if (!META_RE.test(html)) throw new Error("no CSP <meta> tag to update");
  return html.replace(META_RE, `<meta http-equiv="Content-Security-Policy" content="${policyFor(html, extra)}">`);
}

export function currentPolicy(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  return m ? m[1] : null;
}

/** Problems with one page's CSP: [] when it is present and matches the page's inline code. */
export function checkPage(html, extra) {
  const cur = currentPolicy(html);
  if (cur === null) return ["no CSP <meta> tag"];
  const metaAt = html.indexOf("Content-Security-Policy"), firstCode = html.search(/<(script|style)[\s>]/i);
  const problems = [];
  if (firstCode !== -1 && metaAt > firstCode) problems.push("CSP <meta> must come before the first <script> or <style>");
  if (cur !== policyFor(html, extra)) problems.push("CSP is out of date: run  node tools/csp.mjs");
  return problems;
}

function main(args) {
  const check = args.includes("--check");
  let bad = 0;
  for (const [file, extra] of Object.entries(PAGES)) {
    const html = readFileSync(file, "utf8");
    if (check) {
      const p = checkPage(html, extra);
      for (const x of p) console.log(`${file}: ${x}`);
      bad += p.length;
    } else {
      writeFileSync(file, withPolicy(html, extra));
      console.log(`${file}: CSP updated`);
    }
  }
  if (check && !bad) console.log("CSP: up to date");
  return bad ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
