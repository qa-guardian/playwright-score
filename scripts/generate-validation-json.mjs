#!/usr/bin/env node
// Generates validation.json at the repo root from VALIDATION.md — the single
// source of truth stays the Markdown file a human reads; this just
// re-serializes the same numbers as data so the qaguardian.com website (or
// any other tooling) doesn't have to scrape Markdown. Never hand-edit
// validation.json — re-run this script after VALIDATION.md changes, and see
// tests/validation-json.test.ts, which fails the build if the two ever drift
// apart.
//
// Read from VALIDATION.md: the "## Results" heading (date, version, model,
// threshold), the default gate and its --allow-partial setting in the
// "Tested on" line, the bold summary line, the status line, the manual
// recall line, the two benchmark lines and, when the Results section has
// one, the per-repo table.
//
// Usage: node scripts/generate-validation-json.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATION_MD = path.join(ROOT, 'VALIDATION.md');
const OUT = path.join(ROOT, 'validation.json');

const md = fs.readFileSync(VALIDATION_MD, 'utf8');
const num = (s) => Number(String(s).replace(/,/g, ''));
const pct = (found, total) => Math.round((found / total) * 1000) / 10;
function need(re, what) {
  const m = md.match(re);
  if (!m) throw new Error(`Could not parse ${what} in VALIDATION.md`);
  return m;
}

// "## Results (last run: 2026-11-25, 3.0.0, scoring model v5, `standard`
// profile, threshold 0)"
const [, testedOn, version, model, , threshold] = need(
  /## Results \(last run: ([\d-]+), ([\d.]+), scoring model (v\d+), `(\w+)` profile, threshold (\d+)\)/,
  'the "## Results" heading'
);

// "default gate (`--fail-on passes-regardless`, no score bar, without
// `--allow-partial`)": `with` means a partial result passed the gate.
const [, failOn, partialWord] = need(
  /default gate\s+\(`--fail-on ([a-z,-]+)`[^)]*?\b(with|without)\s+`--allow-partial`\)/,
  'the default gate (with its --allow-partial setting) in the "Tested on" line'
);

// "**221 pass / 58 fail / 279 total (79.2%).** 9,999 files, 99,999 tests, 99,999 findings."
const [, passingStr, , totalStr, filesStr, testsStr, findingsStr] = need(
  /\*\*(\d+) pass \/ (\d+) fail \/ (\d+) total \([\d.]+%\)\.\*\* ([\d,]+) files, ([\d,]+) tests, ([\d,]+) findings/,
  'the corpus summary line'
);
// "Status: 279 scored, 0 partial, 0 not scored"
const [, scoredStr, partialStr, notScoredStr] = need(
  /Status: ([\d,]+) scored, ([\d,]+) partial, ([\d,]+) not scored/,
  'the status line'
);
// "**Manual recall: 75%** (27 of 36 ..."
const [, manualPctStr, manualFoundStr, manualTotalStr] = need(
  /\*\*Manual recall: ([\d.]+)%\*\* \((\d+) of (\d+) /,
  'the manual recall line'
);
// "Development benchmark: 152 of 155 ..." and "Sealed set: 210 of 234 ...",
// both under "## Regression benchmark" (recall.benchmarkDevelopment and
// recall.benchmarkSealed).
const [, devFoundStr, devTotalStr] = need(/Development benchmark: (\d+) of (\d+) /, 'the development benchmark line');
const [, sealedFoundStr, sealedTotalStr] = need(/Sealed set: (\d+) of (\d+) /, 'the sealed set line');

const manual = { classes: num(manualTotalStr), found: num(manualFoundStr), recall: pct(num(manualFoundStr), num(manualTotalStr)) };
if (Math.round(manual.recall) !== Math.round(Number(manualPctStr))) {
  throw new Error(`Manual recall line says ${manualPctStr}% but ${manual.found} of ${manual.classes} is ${manual.recall}%`);
}

// Optional per-repo table, one row each, e.g.:
// | [pinterest/gestalt](https://github.com/pinterest/gestalt/tree/22874a7522d1/playwright/accessibility) | Apache-2.0 | 100 | A | ✓ | 173 | 173 | 1 | [2026-09-24](https://github.com/pinterest/gestalt/commit/22874a7522d1803df992fae2bcb31ef42be29519) |
const rowRe =
  /^\| \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\) \| ([^|]+) \| (\d+) \| ([A-F]) \| (✓|✗ FAIL) \| (\d+) \| (\d+) \| (\d+) \| \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\) \|$/gm;

const repos = [];
let match;
while ((match = rowRe.exec(md)) !== null) {
  const [, rawLabel, url, , scoreStr, grade, passSymbol, rowFiles, rowTests, , testedOnRow, commitUrl] = match;
  const competitor = /\*\(competitor\)\*/.test(rawLabel);
  const name = rawLabel.replace(/\s*\*\(competitor\)\*\s*$/, '').trim();

  const treeMatch = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([0-9a-f]+)\/(.*)$/);
  if (!treeMatch) throw new Error(`Could not parse repo tree URL: ${url}`);
  const [, repo, sha, subpath] = treeMatch;

  repos.push({
    name,
    repo,
    subpath,
    url,
    sha,
    testedOn: testedOnRow,
    score: Number(scoreStr),
    grade,
    pass: passSymbol.startsWith('✓'),
    files: Number(rowFiles),
    tests: Number(rowTests),
    competitor,
    commitUrl,
  });
}

const totals = {
  repos: num(totalStr),
  files: num(filesStr),
  tests: num(testsStr),
  findings: num(findingsStr),
  passing: num(passingStr),
  scored: num(scoredStr),
  partial: num(partialStr),
  notScored: num(notScoredStr),
};
if (totals.scored + totals.partial + totals.notScored !== totals.repos) {
  throw new Error(`Status line counts ${totals.scored + totals.partial + totals.notScored} suites but the summary line says ${totals.repos}`);
}
// The table is optional; when it is there it must list every suite.
if (repos.length > 0) {
  if (totals.repos !== repos.length) {
    throw new Error(`Summary line says ${totals.repos} repos but parsed ${repos.length} table rows`);
  }
  const passingCount = repos.filter((r) => r.pass).length;
  if (passingCount !== totals.passing) {
    throw new Error(`Summary line says ${totals.passing} passing but ${passingCount} rows have pass=true`);
  }
}

const output = {
  version,
  model,
  testedOn,
  threshold: Number(threshold),
  gate: { failOn: failOn.split(','), allowPartial: partialWord === 'with' },
  recall: {
    manual,
    benchmarkDevelopment: { seeded: num(devTotalStr), found: num(devFoundStr), recall: pct(num(devFoundStr), num(devTotalStr)) },
    benchmarkSealed: { cases: num(sealedTotalStr), found: num(sealedFoundStr), recall: pct(num(sealedFoundStr), num(sealedTotalStr)) },
  },
  totals,
  repos,
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${totals.repos} suites, ${totals.passing} passing, ${repos.length} table rows.`);
