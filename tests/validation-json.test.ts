import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// validation.json is generated from VALIDATION.md's own "## Results" table
// by scripts/generate-validation-json.mjs (see its header comment) — it is
// NOT hand-maintained and is deliberately excluded from the npm tarball
// (package.json's "files" list), since it exists for the GitHub repo /
// website, not for package consumers. This test is the drift guard: it
// re-derives the same headline numbers independently from VALIDATION.md's
// prose and table, and fails if validation.json (or VALIDATION.md itself)
// was edited without regenerating the other.

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
    totals: { repos: number; files: number; tests: number; passing: number };
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

  it('headline totals match VALIDATION.md\'s summary line', () => {
    const summary = md.match(/\*\*(\d+) pass \/ (\d+) fail \/ (\d+) total \([\d.]+%\)\.\*\* ([\d,]+) files, ([\d,]+) tests,/);
    assert.ok(summary, "expected VALIDATION.md's bold pass/fail/total summary line to still be parseable");
    const [, passing, , total, files, tests] = summary!;
    assert.equal(data.totals.repos, Number(total));
    assert.equal(data.totals.passing, Number(passing));
    assert.equal(data.totals.files, Number(files.replace(/,/g, '')));
    assert.equal(data.totals.tests, Number(tests.replace(/,/g, '')));
  });

  it('repo count and pass count in the repos array match the declared totals', () => {
    assert.equal(data.repos.length, data.totals.repos);
    assert.equal(data.repos.filter((r) => r.pass).length, data.totals.passing);
  });

  it('every VALIDATION.md table row has a corresponding validation.json entry with the same score/grade/pass', () => {
    const rowRe =
      /^\| \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\) \| [^|]+ \| (\d+) \| ([A-F]) \| (✓|✗ FAIL) \| (\d+) \| (\d+) \| \d+ \|/gm;
    const rows: Array<{ url: string; score: number; grade: string; pass: boolean }> = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(md)) !== null) {
      rows.push({ url: m[2], score: Number(m[3]), grade: m[4], pass: m[5].startsWith('✓') });
    }
    assert.ok(rows.length > 0, 'expected to parse at least one table row from VALIDATION.md');
    assert.equal(rows.length, data.repos.length, 'VALIDATION.md table row count must match validation.json repo count');

    const byUrl = new Map(data.repos.map((r) => [r.url, r]));
    for (const row of rows) {
      const entry = byUrl.get(row.url);
      assert.ok(entry, `validation.json is missing an entry for ${row.url}`);
      assert.equal(entry!.score, row.score, `score mismatch for ${row.url}`);
      assert.equal(entry!.grade, row.grade, `grade mismatch for ${row.url}`);
      assert.equal(entry!.pass, row.pass, `pass mismatch for ${row.url}`);
    }
  });

  it('every repo URL is pinned to the exact SHA recorded alongside it', () => {
    for (const r of data.repos) {
      assert.ok(r.url.includes(`/tree/${r.sha}/`), `${r.repo}: url ${r.url} does not embed sha ${r.sha}`);
    }
  });

  it('exactly the three named competitors are flagged (VALIDATION.md: Checkly, Currents, LambdaTest)', () => {
    const competitors = data.repos.filter((r) => r.competitor).map((r) => r.repo).sort();
    assert.deepEqual(
      competitors,
      ['LambdaTest/playwright-sample', 'checkly/checkly-cli', 'currents-dev/currents-examples'].sort()
    );
  });

  it('version/model/threshold match this package\'s own package.json and VALIDATION.md heading', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    assert.equal(data.version, pkg.version);
    assert.equal(data.model, 'v4');
    assert.equal(data.threshold, 80);
  });
});
