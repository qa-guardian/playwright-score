import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { MAX_SOURCE_BYTES } from '../src/fs-util.js';
import type { ScoreResult } from '../src/types.js';

// QAG-287 S5a.1: rows 10, 10r and 04 of the admission decision table
// (src/admission.ts), end to end. Each case is scored twice: through
// `scorePaths` in this process, and through the real CLI with default flags,
// which is where the exit code comes from.
//
// Row 10: a file of another test framework over 1 MB is set aside into
// `skippedFiles`. It is never a skipped Playwright file, so a passing suite
// beside it stays `scored` with exit 0.
// Row 04: a config-matched file that is not named like a spec and cannot be
// parsed is not a Playwright file, whatever it imports. It is left out and
// listed nowhere.

const execFileAsync = promisify(execFile);

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
function suite(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-adm-'));
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
  result: ScoreResult;
}
/** The library call and the CLI on the same input; the two results must agree. */
async function score(args: string[], cwd: string): Promise<Run> {
  const result = await scorePaths({ paths: args, profile: 'standard', threshold: 80, cwd });
  let code = 0;
  let stdout = '';
  try {
    stdout = (await execFileAsync(process.execPath, [cli, ...args, '--format', 'json'], { maxBuffer: 64 * 1024 * 1024, cwd })).stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    code = typeof e.code === 'number' ? e.code : -1;
    stdout = e.stdout ?? '';
    assert.ok(stdout.length > 0, `no JSON from the CLI (exit ${code}): ${e.stderr ?? ''}`);
  }
  const fromCli = JSON.parse(stdout) as ScoreResult;
  assert.equal(fromCli.status, result.status);
  assert.equal(fromCli.reason, result.reason);
  assert.equal(fromCli.score, result.score);
  assert.deepEqual(fromCli.coverage, result.coverage);
  assert.deepEqual(fromCli.skippedFiles ?? [], result.skippedFiles ?? []);
  return { code, result };
}

const names = (list: readonly string[] | undefined): string[] => (list ?? []).map((f) => path.basename(f));
const skippedNames = (r: ScoreResult): string[] => (r.coverage?.skipped ?? []).map((s) => path.basename(s.file));

/** `prefix`, then an array literal of padding rows, at least `total` bytes in all. */
function padded(prefix: string, total: number, name = 'rows'): string {
  const row = '  "row-0000000",\n';
  const count = Math.ceil(Math.max(0, total - prefix.length) / row.length);
  return `${prefix}const ${name} = [\n${row.repeat(count)}];\n`;
}

const GOOD = `import { test, expect } from '@playwright/test';

test('opens the orders page', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
`;
const VITEST = `import { describe, it, expect } from 'vitest';

describe('invoice totals', () => {
  it('adds the line items', () => {
    expect(12 + 30).toBe(42);
  });
});
`;
const JEST_GLOBALS = `describe('invoice totals', () => {
  it('adds the line items', () => {
    expect(12 + 30).toBe(42);
  });
});
`;
const LATE_TEST = `
test('late call', async ({ page }) => {
  await page.goto('/late');
});
`;
const BROKEN = `import { test, expect } from '@playwright/test';

test('saves the profile', async ({ page }) => {
  await page.goto('/profile'
  await expect(page.getByRole('status')).toHaveText('Saved');
});
`;
const GIT = { '.git/HEAD': 'ref: refs/heads/trunk\n' };
const BIG = Math.floor(1.2 * 1024 * 1024);

type Route = 'G' | 'D' | 'CS';
/** One file of another framework on a route, alone or beside a clean spec. */
function routed(route: Route, name: string, content: string, beside: boolean): { dir: string; args: string[] } {
  const sub = route === 'CS' ? 'tests/' : '';
  const files: Record<string, string> = { [sub + name]: content };
  if (beside) files[`${sub}orders.spec.ts`] = GOOD;
  if (route === 'CS') {
    Object.assign(files, GIT, {
      'playwright.config.ts': `import { defineConfig } from '@playwright/test';\n\nexport default defineConfig({ testDir: './tests', testMatch: ['**/*.ts'] });\n`,
    });
  }
  const dir = suite(files);
  return { dir, args: [route === 'G' ? path.join(dir, '*') : dir] };
}

function expectOtherFrameworkBeside(r: Run, name: string): void {
  assert.equal(r.result.status, 'scored', JSON.stringify(r.result.coverage));
  assert.equal(r.result.reason, undefined);
  assert.deepEqual(r.result.coverage?.skipped, []);
  assert.deepEqual(names(r.result.skippedFiles), [name]);
  assert.equal(r.result.coverage?.filesFound, 1);
  assert.equal(r.result.coverage?.filesScored, 1);
  assert.equal(r.result.summary.files, 1);
  assert.equal(r.result.pass, true);
  assert.equal(r.code, 0);
}
function expectOtherFrameworkAlone(r: Run, name: string): void {
  assert.equal(r.result.status, 'not-scored', JSON.stringify(r.result.coverage));
  assert.equal(r.result.reason, 'no-files');
  assert.deepEqual(r.result.coverage?.skipped, []);
  assert.deepEqual(names(r.result.skippedFiles), [name]);
  assert.equal(r.result.coverage?.filesFound, 0);
  assert.equal(r.code, 1);
}

describe('QAG-287 S5a.1 row 10: a file of another framework over 1 MB is set aside, never a skipped Playwright file', () => {
  const large = padded(VITEST, BIG);

  for (const route of ['D', 'G', 'CS'] as const) {
    it(`row 10, route ${route}: a 1.2 MB Vitest file beside a clean spec leaves the suite scored, exit 0`, async () => {
      assert.ok(Buffer.byteLength(large) > MAX_SOURCE_BYTES);
      const { dir, args } = routed(route, 'invoice-totals.test.ts', large, true);
      expectOtherFrameworkBeside(await score(args, dir), 'invoice-totals.test.ts');
    });

    it(`row 10, route ${route}: a 1.2 MB Vitest file alone is not-scored/no-files, with the file in skippedFiles`, async () => {
      const { dir, args } = routed(route, 'invoice-totals.test.ts', large, false);
      expectOtherFrameworkAlone(await score(args, dir), 'invoice-totals.test.ts');
    });
  }

  it('row 10, route D: the same Vitest file under the cap has the same outcome (row 05); the size changes nothing', async () => {
    const { dir, args } = routed('D', 'invoice-totals.test.ts', VITEST, true);
    expectOtherFrameworkBeside(await score(args, dir), 'invoice-totals.test.ts');
  });

  it('row 10r, route D: injected globals in the first 1 MB and a test() call only after it: still another framework\'s file', async () => {
    // The head (the first 1 MB) holds describe/it on injected globals and no
    // Playwright evidence. The array closes after the cut, and the only
    // test() call follows it.
    const head = padded(JEST_GLOBALS, MAX_SOURCE_BYTES + 4096);
    const late = padded(head + LATE_TEST, BIG, 'more');
    assert.ok(Buffer.byteLength(late) > MAX_SOURCE_BYTES);
    assert.ok(!late.slice(0, MAX_SOURCE_BYTES).includes('test('));
    assert.ok(late.indexOf('test(') > MAX_SOURCE_BYTES);

    const beside = routed('D', 'invoice-totals.test.ts', late, true);
    expectOtherFrameworkBeside(await score(beside.args, beside.dir), 'invoice-totals.test.ts');
    const alone = routed('D', 'invoice-totals.test.ts', late, false);
    expectOtherFrameworkAlone(await score(alone.args, alone.dir), 'invoice-totals.test.ts');
  });
});

describe('QAG-287 S5a.1 row 04: a config-matched file that cannot be parsed is not a Playwright file', () => {
  const CONFIG = `import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: './tests', testMatch: ['**/*.ts'] });
`;

  it('row 04, route CN: a Playwright import and a syntax error under the cap, alone: not-scored/no-files, listed nowhere', async () => {
    const dir = suite({ ...GIT, 'playwright.config.ts': CONFIG, 'tests/profile-flows.ts': BROKEN });
    const r = await score([dir], dir);
    assert.equal(r.result.status, 'not-scored', JSON.stringify(r.result.coverage));
    assert.equal(r.result.reason, 'no-files');
    assert.equal(r.code, 1);
    assert.deepEqual(r.result.coverage?.skipped, []);
    assert.deepEqual(r.result.skippedFiles ?? [], []);
    assert.equal(r.result.coverage?.filesFound, 0);
    assert.deepEqual(r.result.findings.filter((f) => f.rule === 'playwright-score/parse-error'), []);
  });

  it('row 04, route CN: the same file beside a clean spec: scored, exit 0, in neither coverage.skipped nor skippedFiles', async () => {
    const dir = suite({ ...GIT, 'playwright.config.ts': CONFIG, 'tests/profile-flows.ts': BROKEN, 'tests/orders.spec.ts': GOOD });
    const r = await score([dir], dir);
    assert.equal(r.result.status, 'scored', JSON.stringify(r.result.coverage));
    assert.equal(r.result.reason, undefined);
    assert.equal(r.code, 0);
    assert.equal(r.result.pass, true);
    assert.deepEqual(r.result.coverage?.skipped, []);
    assert.ok(!skippedNames(r.result).includes('profile-flows.ts'));
    assert.ok(!names(r.result.skippedFiles).includes('profile-flows.ts'));
    assert.deepEqual(r.result.skippedFiles ?? [], []);
    assert.equal(r.result.coverage?.filesFound, 1);
    assert.equal(r.result.coverage?.filesScored, 1);
    assert.ok(!r.result.findings.some((f) => f.file !== undefined && path.basename(f.file) === 'profile-flows.ts'));
  });

  it('row 08, route CN: the same file without the syntax error is a Playwright file and is scored (the control)', async () => {
    const fixed = BROKEN.replace(`page.goto('/profile'`, `page.goto('/profile');`);
    const dir = suite({ ...GIT, 'playwright.config.ts': CONFIG, 'tests/profile-flows.ts': fixed, 'tests/orders.spec.ts': GOOD });
    const r = await score([dir], dir);
    assert.equal(r.result.status, 'scored', JSON.stringify(r.result.coverage));
    assert.equal(r.result.coverage?.filesFound, 2);
    assert.equal(r.result.coverage?.filesScored, 2);
    assert.equal(r.code, 0);
  });
});
