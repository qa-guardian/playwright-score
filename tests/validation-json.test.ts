import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// validation.json is generated from VALIDATION.md by
// scripts/generate-validation-json.mjs (see its header comment) — it is
// NOT hand-maintained and is deliberately excluded from the npm tarball
// (package.json's "files" list), since it exists for the GitHub repo /
// website, not for package consumers. This test is the drift guard: it
// re-derives the same headline numbers independently from VALIDATION.md's
// prose (and its per-repo table, when it has one) and fails if
// validation.json (or VALIDATION.md itself) was edited without
// regenerating the other.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'VALIDATION.md'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const md = fs.readFileSync(path.join(root, 'VALIDATION.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const num = (s: string): number => Number(s.replace(/,/g, ''));

describe('validation.json stays in sync with VALIDATION.md', () => {
  it('validation.json exists and is not hand-edited stale JSON', () => {
    assert.ok(fs.existsSync(path.join(root, 'validation.json')), 'run `node scripts/generate-validation-json.mjs` to (re)generate it');
  });

  const raw = fs.readFileSync(path.join(root, 'validation.json'), 'utf8');
  const data = JSON.parse(raw) as {
    version: string;
    model: string;
    testedOn: string;
    threshold: number;
    gate: { failOn: string[]; allowPartial: boolean };
    recall: {
      manual: { classes: number; found: number; recall: number };
      regressionBenchmark: { seeded: number; found: number; recall: number };
      sealed: { cases: number; found: number; recall: number };
    };
    totals: {
      repos: number;
      files: number;
      tests: number;
      findings: number;
      passing: number;
      scored: number;
      partial: number;
      notScored: number;
    };
    repos: Array<{
      name: string;
      repo: string;
      subpath: string;
      url: string;
      sha: string;
      score: number;
      grade: string;
      pass: boolean;
      files: number;
      tests: number;
      competitor: boolean;
    }>;
  };

  it('headline totals match VALIDATION.md\'s summary and status lines', () => {
    const summary = md.match(/\*\*(\d+) pass \/ (\d+) fail \/ (\d+) total \([\d.]+%\)\.\*\* ([\d,]+) files, ([\d,]+) tests, ([\d,]+) findings/);
    assert.ok(summary, "expected VALIDATION.md's bold pass/fail/total summary line to still be parseable");
    const [, passing, failing, total, files, tests, findings] = summary!;
    assert.equal(data.totals.repos, Number(total));
    assert.equal(Number(passing) + Number(failing), Number(total));
    assert.equal(data.totals.passing, Number(passing));
    assert.equal(data.totals.files, num(files));
    assert.equal(data.totals.tests, num(tests));
    assert.equal(data.totals.findings, num(findings));

    const status = md.match(/Status: ([\d,]+) scored, ([\d,]+) partial, ([\d,]+) not scored/);
    assert.ok(status, "expected VALIDATION.md's status line to still be parseable");
    assert.deepEqual(
      [data.totals.scored, data.totals.partial, data.totals.notScored],
      [num(status![1]), num(status![2]), num(status![3])]
    );
    assert.equal(data.totals.scored + data.totals.partial + data.totals.notScored, data.totals.repos);
  });

  it('recall figures match VALIDATION.md, manual recall first and the benchmarks under their own heading', () => {
    const manual = md.match(/\*\*Manual recall: ([\d.]+)%\*\* \((\d+) of (\d+) /);
    assert.ok(manual, "expected VALIDATION.md's manual recall line to still be parseable");
    assert.equal(data.recall.manual.found, Number(manual![2]));
    assert.equal(data.recall.manual.classes, Number(manual![3]));
    assert.equal(Math.round(data.recall.manual.recall), Math.round(Number(manual![1])));

    const benchmarkAt = md.indexOf('## Regression benchmark');
    assert.ok(benchmarkAt > 0, 'expected a "## Regression benchmark" heading');
    assert.ok(md.indexOf('Manual recall') < benchmarkAt, 'manual recall must come before the regression benchmark');
    const dev = md.slice(benchmarkAt).match(/Development benchmark: (\d+) of (\d+) /);
    const sealed = md.slice(benchmarkAt).match(/Sealed set: (\d+) of (\d+) /);
    assert.ok(dev && sealed, 'expected the development benchmark and sealed set lines under "## Regression benchmark"');
    assert.deepEqual([data.recall.regressionBenchmark.found, data.recall.regressionBenchmark.seeded], [Number(dev![1]), Number(dev![2])]);
    assert.deepEqual([data.recall.sealed.found, data.recall.sealed.cases], [Number(sealed![1]), Number(sealed![2])]);
  });

  it('a per-repo table, when VALIDATION.md has one, lists every suite with the same score/grade/pass', () => {
    const rowRe =
      /^\| \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\) \| [^|]+ \| (\d+) \| ([A-F]) \| (✓|✗ FAIL) \| (\d+) \| (\d+) \| \d+ \|/gm;
    const rows: Array<{ url: string; score: number; grade: string; pass: boolean }> = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(md)) !== null) {
      rows.push({ url: m[2], score: Number(m[3]), grade: m[4], pass: m[5].startsWith('✓') });
    }
    assert.equal(rows.length, data.repos.length, 'VALIDATION.md table row count must match validation.json repo count');
    if (rows.length === 0) return;
    assert.equal(data.repos.length, data.totals.repos);
    assert.equal(data.repos.filter((r) => r.pass).length, data.totals.passing);

    const byUrl = new Map(data.repos.map((r) => [r.url, r]));
    for (const row of rows) {
      const entry = byUrl.get(row.url);
      assert.ok(entry, `validation.json is missing an entry for ${row.url}`);
      assert.equal(entry!.score, row.score, `score mismatch for ${row.url}`);
      assert.equal(entry!.grade, row.grade, `grade mismatch for ${row.url}`);
      assert.equal(entry!.pass, row.pass, `pass mismatch for ${row.url}`);
    }
    for (const r of data.repos) {
      assert.ok(r.url.includes(`/tree/${r.sha}/`), `${r.repo}: url ${r.url} does not embed sha ${r.sha}`);
    }
  });

  it('model, threshold and gate match VALIDATION.md (version is not checked against package.json here — the corpus is re-run less often than patch releases, so validation.json\'s version can legitimately lag package.json\'s by a patch or two; see scripts/generate-validation-json.mjs)', () => {
    assert.equal(data.model, 'v5');
    assert.equal(data.threshold, 0);
    assert.deepEqual(data.gate, { failOn: ['passes-regardless'], allowPartial: false });
  });

  it('README.md\'s headline numbers (suites, files, tests, pass count, tested-on date) match validation.json', () => {
    const headline = readme.match(
      /\*\*(\d+) suites · ([\d,]+) files · ([\d,]+) tests · (\d+)\/(\d+) pass \(default gate\) ·\s*\n?tested on (\d{4}-\d{2}-\d{2})\*\*/
    );
    assert.ok(headline, "expected README.md's bold headline-numbers line to still be parseable");
    const [, repos, files, tests, passing, total, testedOn] = headline!;
    assert.equal(Number(repos), data.totals.repos, 'README suite count vs validation.json totals.repos');
    assert.equal(Number(total), data.totals.repos, 'README pass-count denominator vs validation.json totals.repos');
    assert.equal(num(files), data.totals.files, 'README files vs validation.json totals.files');
    assert.equal(num(tests), data.totals.tests, 'README tests vs validation.json totals.tests');
    assert.equal(Number(passing), data.totals.passing, 'README pass count vs validation.json totals.passing');
    assert.equal(testedOn, data.testedOn, 'README tested-on date vs validation.json testedOn');
  });
});
