import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { formatText } from '../src/formatters/text.js';
import { formatMarkdown } from '../src/formatters/markdown.js';
import { MAX_SOURCE_BYTES, readHead, resolveDotSlashAbsolute } from '../src/fs-util.js';
import type { ScoreResult } from '../src/types.js';

// QAG-287 S5a.1: hostile and odd inputs (the R9 fuzz list). Each title names
// the row of the admission decision table (src/admission.ts) the case lands on. Each case runs the real CLI in its own
// process: no uncaught exception (the exit code is never 2), and a documented
// `status` and exit code. --threshold 0 is used so that exit 1 can only come
// from the status (`partial` or `not-scored`), never from a low score.
//
// Documented outcomes:
//   scored      exit 0 (at threshold 0)
//   partial     exit 1, `coverage.skipped` lists each skipped file
//   not-scored  exit 1, score 0, grade F, `reason` is no-files or no-counted-tests
//
// Owned by other slices: forced --max-seconds 1 and --max-heap-mb 256 (S5b);
// "every test skipped" becoming not-scored (S9a; the case below pins today's result).

const execFileAsync = promisify(execFile);

// Measured at the parent commit (2f3f390) for the "every test skipped" suite below.
const EVERY_TEST_SKIPPED_PARENT_SCORE = 94;
const EVERY_TEST_SKIPPED_PARENT_FINDINGS = 2;

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const cli = path.join(packageRoot(), 'dist', 'cli.js');

const tmpDirs: string[] = [];
function suite(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-fuzz-'));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Run {
  code: number;
  stderr: string;
  result: ScoreResult;
}
async function run(args: string[], cwd?: string): Promise<Run> {
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    const r = await execFileAsync(process.execPath, [cli, ...args, '--format', 'json', '--threshold', '0'], {
      maxBuffer: 256 * 1024 * 1024,
      cwd,
    });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    code = typeof e.code === 'number' ? e.code : -1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  assert.notEqual(code, 2, `tool error: ${stderr}`);
  assert.ok(code === 0 || code === 1, `exit code ${code}: ${stderr}`);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(stderr), `stack trace on stderr: ${stderr}`);
  return { code, stderr, result: JSON.parse(stdout) as ScoreResult };
}

function expectScored(r: Run, files: number): void {
  assert.equal(r.result.status, 'scored', JSON.stringify(r.result.coverage));
  assert.equal(r.code, 0);
  assert.equal(r.result.reason, undefined);
  assert.deepEqual(r.result.coverage?.skipped, []);
  assert.equal(r.result.coverage?.filesFound, files);
  assert.equal(r.result.coverage?.filesScored, files);
}
function expectNotScored(r: Run, reason: 'no-files' | 'no-counted-tests'): void {
  assert.equal(r.result.status, 'not-scored', JSON.stringify(r.result.coverage));
  assert.equal(r.result.reason, reason);
  assert.equal(r.code, 1);
  assert.equal(r.result.score, 0);
  assert.equal(r.result.grade, 'F');
  assert.equal(r.result.pass, false);
}
function expectPartial(r: Run, skipped: Array<[string, string]>, scored: number): void {
  assert.equal(r.result.status, 'partial', JSON.stringify(r.result.coverage));
  assert.equal(r.code, 1);
  assert.equal(r.result.pass, false);
  assert.equal(r.result.reason, undefined);
  assert.deepEqual(
    r.result.coverage?.skipped.map((s) => [s.file, s.reason]),
    skipped
  );
  assert.equal(r.result.coverage?.filesScored, scored);
  assert.equal(r.result.coverage?.filesFound, scored + skipped.length);
  assert.equal(r.result.summary.files, scored);
}

const GOOD = `import { test, expect } from '@playwright/test';

test('opens the orders page', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
`;
const WAITS = `import { test, expect } from '@playwright/test';

test('waits for the invoice list', async ({ page }) => {
  await page.goto('/invoices');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('list')).toBeVisible();
});
`;
const BROKEN = `import { test, expect } from '@playwright/test';

test('broken', async ({ page }) => {
  await page.goto('/reports'
  await expect(page).toHaveTitle('Reports');
});
`;
const PARSE_ERROR = 'playwright-score/parse-error';

describe('QAG-287 S5a.1 fuzz list: no crash, a documented status and exit code', () => {
  it('row 08, empty file: alone it is not-scored (no-counted-tests); next to a real spec the suite is scored', async () => {
    const alone = await run([suite({ 'empty.spec.ts': '' })]);
    expectNotScored(alone, 'no-counted-tests');
    assert.equal(alone.result.coverage?.filesScored, 1);
    const mixed = await run([suite({ 'empty.spec.ts': '', 'orders.spec.ts': GOOD })]);
    expectScored(mixed, 2);
    assert.equal(mixed.result.summary.tests, 1);
  });

  it('row 08, BOM: scored', async () => {
    const r = await run([suite({ 'bom.spec.ts': '﻿' + GOOD })]);
    expectScored(r, 1);
    assert.equal(r.result.summary.tests, 1);
    assert.equal(r.result.findings.filter((f) => f.rule === PARSE_ERROR).length, 0);
  });

  it('row 08, CRLF line endings: scored, and a finding keeps its line', async () => {
    const r = await run([suite({ 'crlf.spec.ts': WAITS.replace(/\n/g, '\r\n') })]);
    expectScored(r, 1);
    const wait = r.result.findings.find((f) => f.rule === 'playwright/no-wait-for-timeout');
    assert.equal(wait?.line, 5, JSON.stringify(r.result.findings.map((f) => [f.rule, f.line])));
    assert.equal(wait?.excerpt, 'await page.waitForTimeout(1500);');
  });

  it('row 08, comments only: not-scored (no-counted-tests)', async () => {
    const r = await run([suite({ 'notes.spec.ts': '// nothing here yet\n/* a block\n   comment */\n' })]);
    expectNotScored(r, 'no-counted-tests');
    assert.deepEqual(r.result.coverage?.skipped, []);
  });

  it('row 08, a 1 MB minified line: under the cap, scored', async () => {
    const head = `import{test,expect}from'@playwright/test';test('lists the parcels',async({page})=>{await page.goto('/parcels');await expect(page.getByRole('table')).toBeVisible();});const parcels=[`;
    const unit = '12345,';
    const body = head + unit.repeat(Math.floor((MAX_SOURCE_BYTES - head.length - 8) / unit.length)) + '1];';
    assert.ok(body.length <= MAX_SOURCE_BYTES && body.length > MAX_SOURCE_BYTES - 64, String(body.length));
    assert.ok(!body.includes('\n'));
    const r = await run([suite({ 'min.spec.js': body })]);
    expectScored(r, 1);
    assert.equal(r.result.summary.tests, 1);
  });

  it('row 11, a 5 MB file: skipped as too-large; alone not-scored, next to a real spec partial', async () => {
    const big = GOOD + '// padding\n'.repeat(Math.ceil((5 * 1024 * 1024) / 11));
    const alone = await run([suite({ 'big.spec.ts': big })]);
    expectNotScored(alone, 'no-counted-tests');
    assert.deepEqual(
      alone.result.coverage?.skipped.map((s) => [s.file, s.reason]),
      [['big.spec.ts', 'too-large']]
    );
    assert.match(alone.result.coverage?.skipped[0]?.detail ?? '', /^\d+ bytes \(limit 1048576\)$/);
    const mixed = await run([suite({ 'big.spec.ts': big, 'orders.spec.ts': GOOD })]);
    expectPartial(mixed, [['big.spec.ts', 'too-large']], 1);
    assert.equal(mixed.result.score, 100);
  });

  it('rows 08 and 11, the bounded read: one byte over 1 MB is over the cap; exactly 1 MB is read whole', () => {
    const dir = suite({});
    const at = path.join(dir, 'at.spec.ts');
    const over = path.join(dir, 'over.spec.ts');
    fs.writeFileSync(at, Buffer.alloc(MAX_SOURCE_BYTES, 0x20));
    fs.writeFileSync(over, Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x20));
    const whole = readHead(at);
    assert.ok(whole.ok && !whole.overCap && whole.text.length === MAX_SOURCE_BYTES && whole.size === MAX_SOURCE_BYTES);
    assert.ok(whole.ok && whole.text === fs.readFileSync(at, 'utf8'));
    const r = readHead(over);
    assert.ok(r.ok && r.overCap && r.text.length === MAX_SOURCE_BYTES && r.size === MAX_SOURCE_BYTES + 1);
  });

  it('rows 11, 09 and 04, a file over 1 MB that only a config glob matches: a spec is listed as too-large (partial); a non-spec and a binary file are left out', async () => {
    const CONFIG = `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '**/*.ts' });
`;
    const pad = '// padding\n'.repeat(Math.ceil((1.5 * 1024 * 1024) / 11));
    const names = (r: Run) => r.result.coverage?.skipped.map((s) => [path.basename(s.file), s.reason]);

    // A spec without a spec-style name, 1.5 MB, importing @playwright/test.
    const direct = suite({
      '.git/HEAD': 'ref: refs/heads/trunk\n',
      'playwright.config.ts': CONFIG,
      'tests/orders.ts': GOOD,
      'tests/generated-flows.ts': WAITS + pad,
    });
    const r1 = await run([direct], direct);
    assert.equal(r1.result.status, 'partial', JSON.stringify(r1.result.coverage));
    assert.equal(r1.code, 1);
    assert.equal(r1.result.pass, false);
    assert.deepEqual(names(r1), [['generated-flows.ts', 'too-large']]);
    assert.equal(r1.result.coverage?.filesFound, 2);
    assert.equal(r1.result.coverage?.filesScored, 1);

    // The same file under the cap is scored: the cap is the only difference.
    const small = suite({
      '.git/HEAD': 'ref: refs/heads/trunk\n',
      'playwright.config.ts': CONFIG,
      'tests/orders.ts': GOOD,
      'tests/generated-flows.ts': WAITS,
    });
    const r2 = await run([small], small);
    expectScored(r2, 2);

    // Playwright reached through a local module that re-exports it.
    const viaLocal = suite({
      '.git/HEAD': 'ref: refs/heads/trunk\n',
      'playwright.config.ts': CONFIG,
      'tests/orders.ts': GOOD,
      'support/base.ts': `export { test, expect } from '@playwright/test';\n`,
      'tests/generated-flows.ts': WAITS.replace(`'@playwright/test'`, `'../support/base'`) + pad,
    });
    const r3 = await run([viaLocal], viaLocal);
    assert.equal(r3.result.status, 'partial', JSON.stringify(r3.result.coverage));
    assert.equal(r3.code, 1);
    assert.deepEqual(names(r3), [['generated-flows.ts', 'too-large']]);

    // Not specs: a large data module and an MPEG-TS style binary named *.ts.
    const video = Buffer.alloc(2 * 1024 * 1024, 0);
    video[0] = 0x47;
    const others = suite({
      '.git/HEAD': 'ref: refs/heads/trunk\n',
      'playwright.config.ts': CONFIG,
      'tests/orders.ts': GOOD,
      'tests/catalogue-data.ts': `export const rows = [\n${'  "row",\n'.repeat(160000)}];\n`,
      'tests/clip.ts': video,
      'tests/short-clip.ts': Buffer.from([0x47, 0, 0, 0, 1, 2, 3]),
    });
    const r4 = await run([others], others);
    expectScored(r4, 1);
  });

  it('row 08, invalid UTF-8: scored (bytes that are not UTF-8 read as replacement characters)', async () => {
    const bytes = Buffer.concat([
      Buffer.from(`import { test, expect } from '@playwright/test';\n\ntest('shows the note', async ({ page }) => {\n  await page.goto('/notes');\n  await expect(page.getByText('caf`),
      Buffer.from([0xe9, 0xff, 0xfe, 0xc3]),
      Buffer.from(`')).toBeVisible();\n});\n`),
    ]);
    const r = await run([suite({ 'latin1.spec.ts': bytes })]);
    expectScored(r, 1);
    assert.equal(r.result.summary.tests, 1);
  });

  it('row 06, NUL bytes: skipped as binary; alone not-scored, next to a real spec partial', async () => {
    const nul = Buffer.concat([Buffer.from(GOOD.slice(0, 60)), Buffer.from([0, 0, 0]), Buffer.from(GOOD.slice(60))]);
    const alone = await run([suite({ 'blob.spec.ts': nul })]);
    expectNotScored(alone, 'no-counted-tests');
    assert.deepEqual(
      alone.result.coverage?.skipped.map((s) => [s.file, s.reason]),
      [['blob.spec.ts', 'binary']]
    );
    const mixed = await run([suite({ 'blob.spec.ts': nul, 'orders.spec.ts': GOOD })]);
    expectPartial(mixed, [['blob.spec.ts', 'binary']], 1);
  });

  it('row 08, a NUL byte after the first 8 KB is not sniffed', () => {
    const dir = suite({});
    const late = path.join(dir, 'late.spec.ts');
    fs.writeFileSync(late, Buffer.concat([Buffer.alloc(8 * 1024, 0x20), Buffer.from([0])]));
    const r = readHead(late);
    assert.ok(r.ok && !r.nulEarly && !r.overCap);
    fs.writeFileSync(late, Buffer.concat([Buffer.alloc(8 * 1024 - 1, 0x20), Buffer.from([0])]));
    const early = readHead(late);
    assert.ok(early.ok && early.nulEarly);
  });

  it('rows 07 and 08, JSON in a .ts: an object does not parse and an array has no tests; both not-scored', async () => {
    const obj = await run([suite({ 'data.spec.ts': '{\n  "name": "parcel",\n  "ids": [1, 2, 3]\n}\n' })]);
    expectNotScored(obj, 'no-counted-tests');
    assert.deepEqual(
      obj.result.coverage?.skipped.map((s) => [s.file, s.reason]),
      [['data.spec.ts', 'parse-error']]
    );
    assert.ok(obj.result.findings.some((f) => f.rule === PARSE_ERROR));
    const arr = await run([suite({ 'list.spec.ts': '[1, 2, 3]\n' })]);
    expectNotScored(arr, 'no-counted-tests');
    assert.deepEqual(arr.result.coverage?.skipped, []);
  });

  it('row 02, a symlink loop: a looping directory is not walked; a looping or dangling file link is skipped as unreadable', async () => {
    const dir = suite({ 'orders.spec.ts': GOOD });
    fs.symlinkSync('.', path.join(dir, 'again'));
    fs.symlinkSync(dir, path.join(dir, 'self'));
    const dirLoop = await run([dir]);
    expectScored(dirLoop, 1);

    const dir2 = suite({ 'orders.spec.ts': GOOD });
    fs.symlinkSync('ring-b.spec.ts', path.join(dir2, 'ring-a.spec.ts'));
    fs.symlinkSync('ring-a.spec.ts', path.join(dir2, 'ring-b.spec.ts'));
    fs.symlinkSync('gone.ts', path.join(dir2, 'dangling.spec.ts'));
    const fileLoop = await run([dir2]);
    // A link that cannot be resolved is found, never scored, and listed.
    expectPartial(
      fileLoop,
      [
        ['dangling.spec.ts', 'unreadable'],
        ['ring-a.spec.ts', 'unreadable'],
        ['ring-b.spec.ts', 'unreadable'],
      ],
      1
    );
    assert.deepEqual(
      fileLoop.result.coverage?.skipped.map((s) => s.detail),
      ['ENOENT', 'ELOOP', 'ELOOP']
    );

    // Named directly, the looping link is the only file found: not scored.
    const direct = await run([path.join(dir2, 'ring-a.spec.ts')]);
    expectNotScored(direct, 'no-counted-tests');
    assert.deepEqual(direct.result.coverage?.skipped, [{ file: 'ring-a.spec.ts', reason: 'unreadable', detail: 'ELOOP' }]);
  });

  it('row 07, one unparsable file among 3: partial, the other 2 are scored', async () => {
    const dir = suite({ 'a-orders.spec.ts': GOOD, 'b-broken.spec.ts': BROKEN, 'c-invoices.spec.ts': WAITS });
    const r = await run([dir]);
    expectPartial(r, [['b-broken.spec.ts', 'parse-error']], 2);
    assert.equal(r.result.summary.tests, 2);
    assert.equal(r.result.coverage?.testsCounted, 2);
    assert.ok(r.result.score > 0 && r.result.score < 100, String(r.result.score));
    const parse = r.result.findings.filter((f) => f.rule === PARSE_ERROR);
    assert.deepEqual(parse.map((f) => f.file), ['b-broken.spec.ts']);
    assert.ok(r.result.findings.some((f) => f.rule === 'playwright/no-wait-for-timeout' && f.file === 'c-invoices.spec.ts'));
    assert.equal(r.result.summary.findings, r.result.findings.length);

    // The score is the score of the two parsable files on their own: the
    // parse-error finding is not a demerit.
    const two = await run([path.join(dir, 'a-orders.spec.ts'), path.join(dir, 'c-invoices.spec.ts')]);
    expectScored(two, 2);
    assert.equal(r.result.score, two.result.score);
    assert.deepEqual(r.result.dimensions, two.result.dimensions);
    assert.deepEqual(
      r.result.findings.filter((f) => f.rule !== PARSE_ERROR),
      two.result.findings
    );
  });

  it('row 07, every file unparsable: not-scored (no-counted-tests), each file listed', async () => {
    const r = await run([suite({ 'a.spec.ts': BROKEN, 'b.spec.ts': 'test(' })]);
    expectNotScored(r, 'no-counted-tests');
    assert.deepEqual(
      r.result.coverage?.skipped.map((s) => [s.file, s.reason]),
      [
        ['a.spec.ts', 'parse-error'],
        ['b.spec.ts', 'parse-error'],
      ]
    );
    assert.equal(r.result.coverage?.filesScored, 0);
    assert.equal(r.result.findings.filter((f) => f.rule === PARSE_ERROR).length, 2);
  });

  // Owned by slice S9a, which changes this result to not-scored
  // (no-counted-tests). Until then a declared test counts whether or not it
  // can run, and this pins the result this suite had before S5a.1.
  it('row 08, every test skipped: no crash, exit code not 2, and today\'s result (scored; S9a makes it not-scored)', async () => {
    const skipped = `import { test, expect } from '@playwright/test';

test.skip('exports the ledger', async ({ page }) => {
  await page.goto('/ledger');
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
});

test.fixme('imports a ledger', async ({ page }) => {
  await page.goto('/ledger/import');
  await expect(page.getByLabel('File')).toBeVisible();
});
`;
    const r = await run([suite({ 'ledger.spec.ts': skipped })]);
    expectScored(r, 1);
    assert.equal(r.result.summary.tests, 2);
    assert.equal(r.result.coverage?.testsCounted, 2);
    assert.equal(r.result.score, EVERY_TEST_SKIPPED_PARENT_SCORE);
    assert.equal(r.result.summary.findings, EVERY_TEST_SKIPPED_PARENT_FINDINGS);
  });

  it('no candidate, no files (an empty directory, a missing path): not-scored (no-files)', async () => {
    const empty = await run([suite({})]);
    expectNotScored(empty, 'no-files');
    assert.deepEqual(empty.result.coverage, { filesFound: 0, filesScored: 0, testsCounted: 0, skipped: [] });
    const missing = await run([path.join(suite({}), 'nowhere')]);
    expectNotScored(missing, 'no-files');
  });
});

describe('QAG-287 S5a.1: status, coverage and the single-file path', () => {
  it('row 07, a caller that scores one unparsable file (the runner score server) still gets playwright-score/parse-error', async () => {
    const dir = suite({ 'generated.spec.ts': BROKEN });
    const result = await scorePaths({ paths: [path.join(dir, 'generated.spec.ts')], profile: 'standard', threshold: 80, cwd: dir });
    const parse = result.findings.filter((f) => f.rule === PARSE_ERROR);
    assert.equal(parse.length, 1);
    assert.equal(parse[0]?.file, 'generated.spec.ts');
    assert.equal(parse[0]?.severity, 'error');
    assert.equal(parse[0]?.line, 5);
    assert.equal(result.status, 'not-scored');
    assert.equal(result.reason, 'no-counted-tests');
    assert.equal(result.score, 0);
    assert.equal(result.grade, 'F');
    assert.equal(result.pass, false);
    assert.match(formatText(result), /Not scored: 1 file has a syntax error/);
  });

  it('a scored result carries status scored, no reason and an empty skipped list', async () => {
    const dir = suite({ 'orders.spec.ts': GOOD });
    const result = await scorePaths({ paths: [dir], profile: 'standard', threshold: 80, cwd: dir });
    assert.equal(result.status, 'scored');
    assert.ok(!('reason' in result));
    assert.deepEqual(result.coverage, { filesFound: 1, filesScored: 1, testsCounted: 1, skipped: [] });
    assert.equal(result.pass, true);
  });

  it('partial never passes, whatever the threshold, and the text and markdown output say why', async () => {
    const dir = suite({ 'orders.spec.ts': GOOD, 'broken.spec.ts': BROKEN });
    const result = await scorePaths({ paths: [dir], profile: 'standard', threshold: 0, cwd: dir });
    assert.equal(result.status, 'partial');
    assert.equal(result.score, 100);
    assert.equal(result.pass, false);
    const text = formatText(result);
    assert.match(text, /Partial: 1 of 2 files skipped, so this is not a pass\./);
    assert.match(text, /broken\.spec\.ts \(syntax error\)/);
    assert.ok(!/Not scored/.test(text), text);
    assert.match(formatMarkdown(result), /Partial: 1 of 2 files skipped/);
  });

  it('row 05, a file of another test framework is not a coverage skip', async () => {
    const jest = `import { render, screen } from '@testing-library/react';\n\nit('renders', () => {\n  render(null);\n  expect(screen.getByText('x')).toBeInTheDocument();\n});\n`;
    const dir = suite({ 'orders.spec.ts': GOOD, 'widget.test.tsx': jest });
    const result = await scorePaths({ paths: [dir], profile: 'standard', threshold: 80, cwd: dir });
    assert.equal(result.status, 'scored');
    assert.deepEqual(result.skippedFiles, ['widget.test.tsx']);
    assert.deepEqual(result.coverage, { filesFound: 1, filesScored: 1, testsCounted: 1, skipped: [] });
  });

  it('coverage never holds an absolute path', async () => {
    const dir = suite({ 'deep/orders.spec.ts': GOOD, 'deep/broken.spec.ts': BROKEN, 'big.spec.ts': Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x20) });
    fs.symlinkSync('gone.ts', path.join(dir, 'deep', 'dangling.spec.ts'));
    const result = await scorePaths({ paths: [dir], profile: 'standard', threshold: 80, cwd: os.tmpdir() });
    assert.equal(result.status, 'partial');
    const text = JSON.stringify(result.coverage);
    assert.ok(!text.includes(dir), text);
    assert.ok(!text.includes(os.tmpdir()), text);
    for (const s of result.coverage?.skipped ?? []) assert.ok(!path.isAbsolute(s.file), s.file);
  });
});

describe('QAG-287 S5a.1: a ./ prefix in front of an absolute path', () => {
  it('resolves to that directory, and a real relative path is left alone', () => {
    const dir = suite({ 'orders.spec.ts': GOOD, 'sub/x.spec.ts': GOOD });
    assert.equal(resolveDotSlashAbsolute('./' + dir, os.tmpdir()), dir);
    assert.equal(resolveDotSlashAbsolute('.///' + dir.slice(1), os.tmpdir()), dir);
    assert.equal(resolveDotSlashAbsolute('./sub', dir), './sub');
    // A file as well as a directory.
    assert.equal(resolveDotSlashAbsolute('./' + path.join(dir, 'orders.spec.ts'), os.tmpdir()), path.join(dir, 'orders.spec.ts'));
    assert.equal(resolveDotSlashAbsolute(dir, os.tmpdir()), dir);
    assert.equal(resolveDotSlashAbsolute('.//no/such/place-xyz', os.tmpdir()), './/no/such/place-xyz');
    // A path that exists under the current directory wins over the absolute reading.
    fs.mkdirSync(path.join(dir, 'sub', 'sub'));
    assert.equal(resolveDotSlashAbsolute('.//sub', path.join(dir, 'sub')), './/sub');
  });

  it('the CLI scores ./<absolute dir> like <absolute dir>', async () => {
    const dir = suite({ 'orders.spec.ts': GOOD, 'invoices.spec.ts': WAITS });
    const elsewhere = suite({});
    const plain = await run([dir], elsewhere);
    const prefixed = await run(['./' + dir], elsewhere);
    expectScored(prefixed, 2);
    assert.deepEqual(prefixed.result, plain.result);
  });
});
