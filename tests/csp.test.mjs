// Unit tests for the CSP tool. Run: node --test tests/csp.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inlineBlocks, policyFor, withPolicy, checkPage, PAGES } from "../tools/csp.mjs";

const page = (body) => `<!DOCTYPE html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="">
<style>a{}</style></head><body>${body}<script>x=1</script></body>`;

test("inline blocks are found; external scripts are not hashed", () => {
  const h = '<script>a</script><script src="x.js"></script><script type="module">b</script>';
  assert.deepEqual(inlineBlocks(h, "script"), ["a", "b"]);
});

test("the policy denies by default and never allows unsafe-inline or unsafe-eval", () => {
  const p = policyFor(page(""));
  assert.match(p, /^default-src 'none'/);
  assert.match(p, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(p, /connect-src 'none'/);
  assert.doesNotMatch(p, /unsafe-inline|unsafe-eval/);
});

test("a page is clean after withPolicy, and stale after a script changes", () => {
  const fixed = withPolicy(page(""));
  assert.deepEqual(checkPage(fixed), []);
  const edited = fixed.replace("x=1", "x=2");
  assert.deepEqual(checkPage(edited), ["CSP is out of date: run  node tools/csp.mjs"]);
});

test("a missing CSP tag and a CSP placed after code are both reported", () => {
  assert.deepEqual(checkPage("<script>x</script>"), ["no CSP <meta> tag"]);
  const late = withPolicy(page("")).replace(/(<meta http-equiv[^>]+>)\n(<style>a\{\}<\/style>)/, "$2\n$1");
  assert.ok(checkPage(late).includes("CSP <meta> must come before the first <script> or <style>"));
});

test("the published pages carry an up-to-date CSP", () => {
  for (const [file, extra] of Object.entries(PAGES)) {
    assert.deepEqual(checkPage(readFileSync(file, "utf8"), extra), [], file);
  }
});
