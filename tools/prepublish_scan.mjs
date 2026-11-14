// Pre-publish scan: refuses to publish anything that looks like a secret, a real ticket key,
// an internal host or a private term. Exit code 1 when anything is found.
//
//   node tools/prepublish_scan.mjs site
//
// Private terms (company names, project codes, internal field names) never live in this repo:
// they come from the PREPUBLISH_DENYLIST environment variable (a GitHub secret, one term per line)
// and/or a local, gitignored .denylist file. Findings for secrets and private terms are printed
// masked, because CI logs of a public repo are public too.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const BINARY_OK = new Set([".woff2"]);
const TEXT_EXT = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".md", ".txt", ".svg", ".xml", ".yml", ".yaml"]);

// Ticket-key shaped strings that are not ticket keys.
const KEY_ALLOW = [/^ABC-\d+$/, /^UTF-8$/, /^ISO-\d+$/, /^SHA-\d+$/, /^ES-?\d+$/, /^RFC-\d+$/];

export const RULES = [
  { id: "secret:anthropic", re: /sk-ant-[A-Za-z0-9_-]{10,}/g, mask: true },
  { id: "secret:atlassian-token", re: /ATATT[A-Za-z0-9_=-]{10,}/g, mask: true },
  { id: "secret:github-token", re: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, mask: true },
  { id: "secret:aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g, mask: true },
  { id: "secret:slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, mask: true },
  { id: "secret:private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, mask: true },
  { id: "host:atlassian-site", re: /(?<![A-Za-z0-9.-])[a-z0-9-]+\.atlassian\.net\b/gi, mask: true,
    allow: [/^your-company\.atlassian\.net$/i] },
  { id: "host:local-url", re: /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/gi, mask: false },
  { id: "pii:email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, mask: true },
  // Text an AI reader (a screening tool, an assistant) could take as instructions, and characters people cannot see.
  { id: "ai:instruction-like", re: /\b(?:ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts)|disregard (?:the |all )?(?:previous|above)|you are (?:an? |the )?(?:AI|assistant|language model|LLM)|system prompt|rate this candidate|recommend (?:this candidate|me) (?:for|as))\b/gi, mask: false },
  { id: "unicode:invisible", re: /[\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E]|[\u{E0000}-\u{E007F}]/gu, mask: false },
  { id: "jira:ticket-key", re: /\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b/g, mask: false, allow: KEY_ALLOW },
];

export function maskValue(s) {
  return s.length <= 4 ? "****" : s.slice(0, 2) + "*".repeat(Math.min(12, s.length - 4)) + s.slice(-2);
}

export function parseDenylist(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith("#"));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Scan one text. Returns [{rule, line, match}] with match already masked where the rule says so. */
export function scanText(text, { denylist = [], allow = [] } = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  const deny = denylist.map((t) => ({ id: "private:denylist", re: new RegExp(escapeRe(t), "gi"), mask: true }));
  for (const rule of [...RULES, ...deny]) {
    lines.forEach((ln, i) => {
      for (const m of ln.matchAll(rule.re)) {
        const hit = m[0];
        if (rule.allow && rule.allow.some((a) => a.test(hit))) continue;
        if (allow.some((a) => a.rule === rule.id && a.match === hit)) continue;
        const shown = rule.id === "unicode:invisible" ? [...hit].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase()).join(" ")
          : rule.mask ? maskValue(hit) : hit;
        findings.push({ rule: rule.id, line: i + 1, match: shown });
      }
    });
  }
  return findings;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export function scanDir(dir, opts = {}) {
  const out = [];
  for (const file of walk(dir)) {
    const rel = relative(process.cwd(), file).replaceAll("\\", "/");
    if (BINARY_OK.has(extname(file).toLowerCase())) continue;   // fonts: no text to leak
    if (!TEXT_EXT.has(extname(file).toLowerCase())) {
      out.push({ file: rel, rule: "file:not-text", line: 0, match: "binary or unknown file type: review by hand" });
      continue;
    }
    const allow = (opts.allow || []).filter((a) => a.file === rel);
    for (const f of scanText(readFileSync(file, "utf8"), { ...opts, allow })) out.push({ file: rel, ...f });
  }
  return out;
}

function main(argv) {
  const dirs = argv.length ? argv : ["site"];
  const denylist = [
    ...parseDenylist(process.env.PREPUBLISH_DENYLIST),
    ...(existsSync(".denylist") ? parseDenylist(readFileSync(".denylist", "utf8")) : []),
  ];
  const allowPath = "tools/prepublish-allow.json";
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : [];
  for (const a of allow) if (!a.reason) throw new Error(`${allowPath}: every entry needs a reason (${a.file} ${a.rule})`);

  let findings = [];
  for (const d of dirs) {
    if (!existsSync(d)) { console.error(`Not found: ${d}`); return 2; }
    findings = findings.concat(scanDir(d, { denylist, allow }));
  }
  console.log(`Private terms checked: ${denylist.length}${denylist.length ? "" : " (none set: add PREPUBLISH_DENYLIST or .denylist)"}`);
  if (!findings.length) { console.log("Findings: 0 - OK to publish"); return 0; }
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.match}`);
  console.log(`Findings: ${findings.length} - NOT OK to publish`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
