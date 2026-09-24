#!/usr/bin/env node
// Generates validation.json at the repo root from VALIDATION.md's own
// "## Results" table — the single source of truth stays the Markdown file
// a human reads; this just re-serializes the same rows as data so the
// qaguardian.com website (or any other tooling) doesn't have to scrape
// Markdown. Never hand-edit validation.json — re-run this script after
// VALIDATION.md's table changes, and see tests/validation-json.test.ts,
// which fails the build if the two ever drift apart.
//
// Usage: node scripts/generate-validation-json.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATION_MD = path.join(ROOT, 'VALIDATION.md');
const OUT = path.join(ROOT, 'validation.json');

const md = fs.readFileSync(VALIDATION_MD, 'utf8');

// "## Results (last run: 2026-09-24, 2.1.0, scoring model v4, `standard`
// profile, threshold 80)"
const headingMatch = md.match(
  /## Results \(last run: ([\d-]+), ([\d.]+), scoring model (v\d+), `(\w+)` profile, threshold (\d+)\)/
);
if (!headingMatch) throw new Error('Could not parse the "## Results" heading in VALIDATION.md');
const [, testedOn, version, model, , threshold] = headingMatch;

// One table row, e.g.:
// | [pinterest/gestalt](https://github.com/pinterest/gestalt/tree/22874a7522d1/playwright/accessibility) | Apache-2.0 | 100 | A | ✓ | 173 | 173 | 1 | [2026-09-24](https://github.com/pinterest/gestalt/commit/22874a7522d1803df992fae2bcb31ef42be29519) |
const rowRe =
  /^\| \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\) \| ([^|]+) \| (\d+) \| ([A-F]) \| (✓|✗ FAIL) \| (\d+) \| (\d+) \| (\d+) \| \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\) \|$/gm;

const repos = [];
let match;
while ((match = rowRe.exec(md)) !== null) {
  const [, rawLabel, url, , scoreStr, grade, passSymbol, filesStr, testsStr, , testedOnRow, commitUrl] = match;
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
    files: Number(filesStr),
    tests: Number(testsStr),
    competitor,
    commitUrl,
  });
}

if (repos.length === 0) throw new Error('Parsed zero repo rows out of VALIDATION.md — table format likely changed');

// "**65 pass / 35 fail / 100 total (65%).** 7,281 files, 39,059 tests, 45,935 findings."
const summaryMatch = md.match(
  /\*\*(\d+) pass \/ (\d+) fail \/ (\d+) total \([\d.]+%\)\.\*\* ([\d,]+) files, ([\d,]+) tests,/
);
if (!summaryMatch) throw new Error('Could not parse the corpus summary line in VALIDATION.md');
const [, passingStr, , totalStr, filesTotalStr, testsTotalStr] = summaryMatch;

const totals = {
  repos: Number(totalStr),
  files: Number(filesTotalStr.replace(/,/g, '')),
  tests: Number(testsTotalStr.replace(/,/g, '')),
  passing: Number(passingStr),
};

if (totals.repos !== repos.length) {
  throw new Error(`Summary line says ${totals.repos} repos but parsed ${repos.length} table rows`);
}
const passingCount = repos.filter((r) => r.pass).length;
if (passingCount !== totals.passing) {
  throw new Error(`Summary line says ${totals.passing} passing but ${passingCount} rows have pass=true`);
}

const output = {
  version,
  model,
  testedOn,
  threshold: Number(threshold),
  totals,
  repos,
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${repos.length} repos, ${totals.passing} passing.`);
