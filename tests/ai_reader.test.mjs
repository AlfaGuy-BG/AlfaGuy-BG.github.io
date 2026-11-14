// Unit tests for the AI reader's scoring (no model calls). Run: node --test tests/ai_reader.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageText, score, FACTS, resolveCli } from "../tools/ai_reader_eval.mjs";

const GOOD = `1. 11+ years, since 2015
2. A team of 6 QA engineers
3. QA Team Lead at Smart IT
4. ISTQB CTAL-TM (Advanced Level Test Manager), CTFL
5. Cypress, Postman, KrakenD
6. ~30% less test design effort
7. Not stated
8. Sofia, Bulgaria`;

test("a correct answer scores every fact and invents nothing", () => {
  assert.deepEqual(score(GOOD), { found: FACTS.length, of: FACTS.length, missed: [], invented: [] });
});

test("an invented degree, tool or wrong experience is caught", () => {
  const bad = GOOD.replace("Not stated", "Bachelor of Computer Science").replace("Cypress", "Selenium").replace("11+ years", "12 years");
  const s = score(bad);
  assert.deepEqual(s.invented.sort(), ["invented-degree", "invented-tool", "wrong-years"]);
  assert.ok(s.missed.includes("education-unstated"));
});

test("a missing fact is named", () => {
  assert.deepEqual(score(GOOD.replace("Sofia, Bulgaria", "not stated")).missed, ["location"]);
});

test("page text keeps the content and drops scripts, styles and the SVG drawing", () => {
  const t = pageText(readFileSync("site/index.html", "utf8"));
  assert.match(t, /Georgi Krastev/);
  assert.match(t, /1,927/);
  assert.doesNotMatch(t, /requestAnimationFrame|@font-face|<circle/);
});

test("the page itself states every fact the reader is scored on", () => {
  const t = pageText(readFileSync("site/index.html", "utf8"));
  for (const id of ["years", "role", "employer", "cert-tm", "tools", "api", "ai-result", "location"]) {
    assert.match(t, FACTS.find((f) => f.id === id).re, id);
  }
});

test("CLAUDE_CLI_PATH wins over everything else", () => {
  assert.equal(resolveCli({ CLAUDE_CLI_PATH: "X:/tools/claude.exe", PATH: "" }), "X:/tools/claude.exe");
});

test("not on PATH: the installer's usual place is found", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const exe = join(home, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  writeFileSync(exe, "");
  assert.equal(resolveCli({ HOME: home, USERPROFILE: home, PATH: "" }), exe);
});

test("not found anywhere: the error names every place it tried", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  assert.throws(() => resolveCli({ HOME: home, USERPROFILE: home, PATH: "" }), (e) =>
    /Claude Code CLI not found/.test(e.message) && e.message.includes(join(home, ".local", "bin")) && /CLAUDE_CLI_PATH/.test(e.message));
});
