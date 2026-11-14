// Unit tests for the pre-publish scan. Run: node --test tests/scan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanText, scanDir, parseDenylist, maskValue } from "../tools/prepublish_scan.mjs";

const rules = (text, opts) => scanText(text, opts).map((f) => f.rule);

test("a real-looking ticket key is found, the placeholder ABC-123 is not", () => {
  assert.deepEqual(rules("see PRJ-4521 and ABC-123"), ["jira:ticket-key"]);
});

test("common non-ticket patterns are not ticket keys", () => {
  assert.deepEqual(rules('<meta charset="UTF-8"> SHA-256 ISO-8601 ES2015'), []);
});

test("secrets are found and printed masked", () => {
  const f = scanText("key = sk-ant-api03-AbCdEfGhIjKlMnOp");
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, "secret:anthropic");
  assert.ok(!f[0].match.includes("AbCdEfGh"), "secret must not appear in the output");
});

test("Atlassian tokens, GitHub tokens and private keys are found", () => {
  assert.deepEqual(rules("ATATT3xFfGF0abcdefghij"), ["secret:atlassian-token"]);
  assert.deepEqual(rules("ghp_abcdefghijklmnopqrstuvwx"), ["secret:github-token"]);
  assert.deepEqual(rules("-----BEGIN RSA PRIVATE KEY-----"), ["secret:private-key"]);
});

test("a real Atlassian site is found, the placeholder is not", () => {
  assert.deepEqual(rules("https://acme.atlassian.net/browse"), ["host:atlassian-site"]);
  assert.deepEqual(rules("https://your-company.atlassian.net"), []);
});

test("localhost URLs are found (a published page must never call them)", () => {
  assert.deepEqual(rules("new EventSource('http://127.0.0.1:8765/events')"), ["host:local-url"]);
});

test("email addresses are found and masked", () => {
  const f = scanText("mail me: someone@example.org");
  assert.deepEqual(f.map((x) => x.rule), ["pii:email"]);
  assert.ok(!f[0].match.includes("someone"));
});

test("denylist terms match case-insensitively, are masked, and regex characters are literal", () => {
  const denylist = parseDenylist("# comment\nAcmeCorp\n\nfield.x+\n");
  assert.deepEqual(denylist, ["AcmeCorp", "field.x+"]);
  const f = scanText("ACMECORP uses field.x+ but not fieldAxx", { denylist });
  assert.deepEqual(f.map((x) => x.rule), ["private:denylist", "private:denylist"]);
  assert.ok(f.every((x) => !/acme/i.test(x.match)));
});

test("an allow entry suppresses exactly that rule and match", () => {
  const allow = [{ rule: "jira:ticket-key", match: "PRJ-1" }];
  assert.deepEqual(rules("PRJ-1 PRJ-2", { allow }), ["jira:ticket-key"]);
});

test("empty and odd input does not throw", () => {
  assert.deepEqual(scanText(""), []);
  assert.deepEqual(parseDenylist(undefined), []);
  assert.equal(maskValue("ab"), "****");
});

test("scanDir reports the file and line, and flags non-text files for review", () => {
  const d = mkdtempSync(join(tmpdir(), "scan-"));
  mkdirSync(join(d, "sub"));
  writeFileSync(join(d, "sub", "a.html"), "ok\nPRJ-77\n");
  writeFileSync(join(d, "b.png"), Buffer.from([0x89, 0x50]));
  const out = scanDir(d);
  assert.equal(out.length, 2);
  const key = out.find((f) => f.rule === "jira:ticket-key");
  assert.equal(key.line, 2);
  assert.ok(key.file.endsWith("sub/a.html"));
  assert.ok(out.some((f) => f.rule === "file:not-text"));
});
