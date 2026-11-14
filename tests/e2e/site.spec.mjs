// The portfolio tests itself: content claims, layout, privacy, accessibility, the ladybug and its fallback.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ALLOWED_HOSTS = new Set(["127.0.0.1:4173"]);   // no third party at all, fonts included

function watch(page) {
  const errors = [], requests = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("request", (r) => requests.push(new URL(r.url())));
  return { errors, requests };
}

test("loads with the right name and title, without errors", async ({ page }) => {
  const w = watch(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Georgi Krastev QA Portfolio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Georgi Krastev");
  await page.waitForLoadState("networkidle");
  expect(w.errors).toEqual([]);
});

test("the run summary matches the suites and cases on the page", async ({ page }) => {
  await page.goto("/");
  const summary = await page.locator(".runbar .status").innerText();
  const [, suites, cases] = summary.match(/(\d+) suites · (\d+) cases passed · 0 failed/) || [];
  expect(Number(suites)).toBe(await page.locator("details.suite").count());
  expect(Number(cases)).toBe(await page.locator("details.suite ul.cases li").count());
});

test("each suite's 'x / y passed' matches its own cases", async ({ page }) => {
  await page.goto("/");
  for (const suite of await page.locator("details.suite").all()) {
    const label = await suite.locator(".count").innerText();
    const [, passed, total] = label.match(/(\d+) \/ (\d+) passed/) || [];
    const n = await suite.locator("ul.cases li").count();
    expect(Number(total), label).toBe(n);
    expect(Number(passed), label).toBe(n);
  }
});

test("no sideways scrolling at this viewport", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the page talks only to itself (no third parties, never a local agent server)", async ({ page }) => {
  const w = watch(page);
  await page.goto("/");
  await page.waitForTimeout(3000);   // let the ladybug start and run a few demo events
  const foreign = w.requests.filter((u) => !ALLOWED_HOSTS.has(u.host)).map((u) => u.href);
  expect(foreign).toEqual([]);
  expect(w.requests.filter((u) => u.pathname === "/events").map((u) => u.href)).toEqual([]);
});

test("with reduced motion, the static ladybug shows and the 3D scene never loads", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const w = watch(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#mark svg")).toBeVisible();
  await expect(page.locator("#mark iframe")).toHaveCount(0);
  expect(w.requests.some((u) => u.pathname.endsWith("/ladybug.html"))).toBe(false);
});

test("with WebGL2, the live ladybug replaces the drawing", async ({ page }) => {
  await page.goto("/");
  const webgl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  test.skip(!webgl2, "this browser has no WebGL2: the fallback test covers it");
  await expect(page.locator("#mark.live")).toBeVisible({ timeout: 10_000 });
  const frame = page.frameLocator("#mark iframe");
  await expect(frame.locator("canvas#c")).toBeVisible();
  const box = await page.locator("#mark iframe").boundingBox();
  const canvas = await frame.locator("canvas#c").boundingBox();
  // regression: the canvas once filled only 42% of its frame (the avatar's narrow-window rule)
  expect(canvas.height).toBeGreaterThan(box.height * 0.95);
});

test("if ladybug.html is missing, the drawing stays and nothing breaks", async ({ page }) => {
  await page.route("**/ladybug.html", (r) => r.fulfill({ status: 404, body: "not found" }));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#mark svg")).toBeVisible();
  await expect(page.locator("#mark.live")).toHaveCount(0);
  await expect(page.locator("#mark iframe")).toHaveCount(0);
});

test("no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const r = await new AxeBuilder({ page }).exclude("#mark iframe").analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.length} node(s)`);
  expect(bad).toEqual([]);
});

test("external links are https and the profile links point to the right places", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  for (const h of hrefs.filter((h) => !h.startsWith("#"))) expect(h, h).toMatch(/^https:\/\//);
  expect(hrefs).toContain("https://www.linkedin.com/in/georgi-krastev-qa/");
});

test("the Content Security Policy blocks nothing the page needs", async ({ page }) => {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto("/");
  await page.waitForTimeout(3000);
  const frames = page.frames();
  const violations = [];
  for (const f of frames) violations.push(...(await f.evaluate(() => window.__csp || []).catch(() => [])));
  expect(violations).toEqual([]);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toMatch(/^default-src 'none'/);
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
});

test("every font the page asks for is served from the site", async ({ page }) => {
  const fonts = [];
  page.on("response", (r) => { if (r.request().resourceType() === "font") fonts.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.length, "no fonts were requested: run npm run fonts").toBeGreaterThan(0);
  expect(fonts.filter((f) => !f.startsWith("200 /fonts/"))).toEqual([]);
});

test("the public ladybug has no debug hook", async ({ page }) => {
  await page.goto("/ladybug.html?debug=1");
  expect(await page.evaluate(() => typeof window.__avatar)).toBe("undefined");
});

test("link previews (LinkedIn, Slack, Teams) get a title, description and a 1200x627 image", async ({ page, request }) => {
  await page.goto("/");
  const og = async (p) => page.locator(`meta[property="og:${p}"]`).getAttribute("content");
  expect(await og("title")).toContain("Georgi Krastev");
  expect((await og("description")).length).toBeGreaterThan(40);
  const img = new URL(await og("image"));
  expect(img.href).toBe("https://alfaguy-bg.github.io/og.png");
  const r = await request.get(img.pathname);
  expect(r.status()).toBe(200);
  const b = await r.body();
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 627]);
});
