# Georgi Krastev · QA portfolio

[![CI](https://github.com/AlfaGuy-BG/AlfaGuy-BG.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfaGuy-BG/AlfaGuy-BG.github.io/actions/workflows/ci.yml)

**Live:** https://alfaguy-bg.github.io

A one-page portfolio written as a test-run report about me, with a live WebGL2 ladybug (the mascot of my QA
investigation agent) acting out a scripted QA run. The page tests itself every night: if a check fails, the
badge turns red and nothing new is published.

## What is checked, and when

| Check | Where | Runs |
|---|---|---|
| Secrets, real ticket keys, internal hosts, e-mail addresses, private terms, text an AI could take as instructions, invisible characters | `tools/prepublish_scan.mjs` | every push, PR, night |
| Content Security Policy present and matching every inline script and style | `tools/csp.mjs` | every push, PR, night |
| Unit tests for the scanner, the CSP tool and the AI reader's scoring (24) | `node --test` | every push, PR, night |
| Secrets anywhere in git history | gitleaks | every push, PR, night |
| Title and name, no page errors | Playwright | desktop + mobile |
| The run summary ("6 suites · 29 cases") matches what the page actually lists | Playwright | desktop + mobile |
| No sideways scrolling | Playwright | desktop + mobile |
| The page only talks to itself: no third parties (fonts are self-hosted), never a local agent server | Playwright | desktop + mobile |
| The CSP blocks nothing the page needs; no `unsafe-inline` / `unsafe-eval` | Playwright | desktop + mobile |
| Every font is served from the site | Playwright | desktop + mobile |
| The public ladybug has no debug hook | Playwright | desktop + mobile |
| Reduced motion: static ladybug, the 3D scene never loads | Playwright | desktop + mobile |
| WebGL2: the live ladybug fills its frame | Playwright | desktop + mobile |
| `ladybug.html` missing: the drawing stays, nothing breaks | Playwright | desktop + mobile |
| No serious or critical accessibility violations (axe) | Playwright | desktop + mobile |
| External links are https; profile links are right | Playwright | desktop + mobile |

Only `site/` is published. Tests and tools never reach GitHub Pages.

## Run it locally (Windows, PowerShell)

```powershell
npm install                          # once; creates package-lock.json: commit it
npx playwright install chromium      # once
npm run fonts                        # once, and after font updates; commit site/fonts
npm test                             # unit tests, scan, then the browser tests
npm run serve                        # view the site at http://127.0.0.1:4173
```

## After editing a script or style

The CSP allows inline code by its hash, so every change to a `<script>` or `<style>` needs `npm run csp`.
The tests fail with "CSP is out of date" if you forget.

## AI reader check (manual)

Does an AI screening tool read this page correctly? `npm run ai-reader` gives the page to a model through the
Claude Code CLI, then plain code scores the answer against 10 fixed facts and 3 kinds of invention (a degree the page
never mentions, tools I don't list, wrong years). Every run needs 9/10 facts and nothing invented. Answers are saved
in `test-results/`. Use `--model haiku` to test what a cheap screener sees, `--runs 5`, `--url https://alfaguy-bg.github.io`.

## Private terms

The scan also refuses words that must never be public (company names, project codes, internal field names).
They are never committed: put them in a local `.denylist` file (gitignored, one term per line) and in the
repository secret `PREPUBLISH_DENYLIST` (Settings → Secrets and variables → Actions). Findings for secrets and
private terms are printed masked, because the logs of a public repository are public too.

A justified exception goes in `tools/prepublish-allow.json`:
`[{"file": "site/index.html", "rule": "jira:ticket-key", "match": "XYZ-1", "reason": "..."}]` (the reason is required).

## Layout

```
site/index.html          the page
site/ladybug.html        the 3D scene: my agent's avatar in demo mode, no network, paused when off screen
tests/e2e/site.spec.mjs  the browser tests
tests/scan.test.mjs      the scanner's unit tests
tools/prepublish_scan.mjs
scripts/serve.mjs        a dependency-free static server for the tests
.github/workflows/ci.yml scan → test → publish
```
