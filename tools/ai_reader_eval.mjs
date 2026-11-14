// AI reader check: does an AI that screens candidates read this page correctly?
// The model only reads and answers; plain code scores the answer against fixed facts (code decides, models propose).
//
//   npm run ai-reader                                   reads site/index.html, 3 runs, the CLI's default model
//   npm run ai-reader -- --model haiku --runs 5
//   npm run ai-reader -- --url https://alfaguy-bg.github.io
//
// Needs the Claude Code CLI signed in (`claude` on PATH, or CLAUDE_CLI_PATH). Not part of CI: it needs a login.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PROMPT = `You are an AI tool that screens candidates for a QA Team Lead role.
Read the candidate page below and answer from the page only. If the page does not say, write "not stated".
Answer these, one line each:
1. Total years of experience in software quality
2. Largest team size the candidate has led
3. Current role and employer
4. Certifications
5. Main test automation and API tools
6. One measurable result from the candidate's AI tooling
7. Education
8. Location`;

// A fact passes when its pattern appears in the answer. A claim fails the run if it appears: the page never says it.
export const FACTS = [
  { id: "years", re: /\b11\+?\s*(?:years|yrs)|since 2015/i },
  { id: "team-size", re: /\b(?:6|six)\b[^\n]{0,40}(?:engineers|people|members|QA)|team of (?:up to )?(?:6|six)/i },
  { id: "role", re: /QA Team Lead/i },
  { id: "employer", re: /Smart IT/i },
  { id: "cert-tm", re: /CTAL-TM|Advanced Level Test Manager|Advanced Test Manager/i },
  { id: "tools", re: /Cypress/i },
  { id: "api", re: /Postman|KrakenD|REST API/i },
  { id: "ai-result", re: /30\s*%|5\s*(?:to|–|-)\s*10 minutes|1,?927/i },
  { id: "location", re: /Sofia/i },
  { id: "education-unstated", re: /not stated|not (?:mentioned|listed|specified|provided)|no (?:education|degree)/i },
];
export const INVENTIONS = [
  { id: "invented-degree", re: /\b(?:bachelor|master'?s|B\.?Sc|M\.?Sc|university degree|PhD)\b/i },
  { id: "invented-tool", re: /\bSelenium\b|\bTestNG\b|\bLoadRunner\b/i },
  { id: "wrong-years", re: /\b(?:12|13|14|15)\+?\s*years\b/i },
];

export function pageText(html) {
  return html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|li|h[1-6]|div|dt|dd|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export function score(answer) {
  const missed = FACTS.filter((f) => !f.re.test(answer)).map((f) => f.id);
  const invented = INVENTIONS.filter((f) => f.re.test(answer)).map((f) => f.id);
  return { found: FACTS.length - missed.length, of: FACTS.length, missed, invented };
}

// Where the Claude Code CLI is: CLAUDE_CLI_PATH, then PATH, then the installers' usual places
// (the same order as the Local Assistant's adapter). The error names everything it tried.
export function resolveCli(env = process.env, platform = process.platform) {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  const r = spawnSync(platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", env });
  const onPath = r.status === 0 ? (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) : "";
  if (onPath) return onPath;
  const home = env.USERPROFILE || env.HOME || "";
  const tried = platform === "win32"
    ? [join(home, ".local", "bin", "claude.exe"), join(env.APPDATA || join(home, "AppData", "Roaming"), "npm", "claude.cmd")]
    : [join(home, ".local", "bin", "claude"), join(home, ".npm-global", "bin", "claude")];
  const hit = tried.find((p) => existsSync(p));
  if (hit) return hit;
  throw new Error(`Claude Code CLI not found. Tried: PATH, ${tried.join(", ")}. Set CLAUDE_CLI_PATH to its full path.`);
}

function askModel(text, model) {
  // The prompt and the page go in on stdin, so nothing from the page ever reaches a command line.
  if (model && !/^[A-Za-z0-9.:-]+$/.test(model)) throw new Error(`invalid --model: ${model}`);
  const cli = resolveCli();
  const flags = ["-p", "--tools", '""', ...(model ? ["--model", model] : [])];
  const r = spawnSync(`"${cli}" ${flags.join(" ")}`, [], {
    input: `${PROMPT}\n\n<candidate_page>\n${text}\n</candidate_page>`, encoding: "utf8", timeout: 180_000, shell: true,
  });
  if (r.error) throw new Error(`could not run ${cli}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cli} exited ${r.status}: ${(r.stderr || "").slice(0, 400)}`);
  return r.stdout.trim();
}

async function main(argv) {
  const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  const runs = Math.max(1, Math.min(10, Number(opt("runs", 3)) || 3));
  const model = opt("model", "");
  const url = opt("url", "");
  const html = url ? await (await fetch(url)).text() : readFileSync("site/index.html", "utf8");
  const text = pageText(html);
  const need = Number(opt("need", 9));

  const results = [];
  for (let i = 1; i <= runs; i++) {
    const answer = askModel(text, model);
    const s = score(answer);
    results.push({ run: i, ...s, answer });
    console.log(`run ${i}: ${s.found}/${s.of} facts` + (s.missed.length ? `, missed: ${s.missed.join(", ")}` : "")
      + (s.invented.length ? `, INVENTED: ${s.invented.join(", ")}` : ""));
  }
  mkdirSync("test-results", { recursive: true });
  const report = `test-results/ai-reader-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(report, JSON.stringify({ model: model || "cli default", source: url || "site/index.html", need, results }, null, 2));
  const ok = results.every((r) => r.found >= need && r.invented.length === 0);
  console.log(`${ok ? "PASS" : "FAIL"}: every run needs ${need}/${FACTS.length} facts and nothing invented. Answers: ${report}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 2; });
}
