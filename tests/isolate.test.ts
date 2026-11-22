import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_HEAP_MB, scorePaths } from '../src/index.js';
import { formatJson } from '../src/formatters/json.js';
import { formatText } from '../src/formatters/text.js';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { analyzeIsolated, BATCH_SIZE, clock, MAX_TIMER_MS, startTimeLimit, toBatches, type AnalysisInput } from '../src/isolate.js';
import { MAX_SOURCE_BYTES } from '../src/fs-util.js';
import type { ScoreResult } from '../src/types.js';

// QAG-287 S5b: the analysis worker (src/isolate.ts). Classification is done
// before a file reaches the worker; the worker's heap and time limits can only
// skip a file into `coverage`, and with no limit hit the output is the output
// of the in-process analysis, byte for byte.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const tmpDirs: string[] = [];
function suite(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-isolate-'));
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

const good = (n: string): string => `import { test, expect } from '@playwright/test';

test('opens page ${n}', async ({ page }) => {
  await page.goto('/p/${n}');
  await expect(page.getByRole('heading', { name: 'Page ${n}' })).toBeVisible();
});
`;
const WAITS = `import { test, expect } from '@playwright/test';

test('waits for the invoice list', async ({ page }) => {
  await page.goto('/invoices');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('list')).toBeVisible();
});
`;
// No expect of its own: it calls a helper another file defines (helper scope and triage are suite-wide).
const USES_HELPER = `import { test } from '@playwright/test';
import { expectCartTotal } from './support/cart';

test('cart total', async ({ page }) => {
  await page.goto('/cart');
  await expectCartTotal(page, '12.00');
});

test('no assertion at all', async ({ page }) => {
  await page.goto('/cart');
  if (await page.locator('.banner').isVisible()) await page.locator('.banner .close').click();
});
`;
const HELPER = `import { expect, type Page } from '@playwright/test';

export async function expectCartTotal(page: Page, total: string) {
  await expect(page.getByTestId('cart-total')).toHaveText(total);
}
`;
const BROKEN = `import { test, expect } from '@playwright/test';

test('broken', async ({ page }) => {
  await page.goto('/reports'
  await expect(page).toHaveTitle('Reports');
});
`;
const VITEST = `import { describe, it, expect } from 'vitest';

describe('sum', () => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
});
`;

const two = (i: number): string => String(i).padStart(2, '0');

/** 3 batches' worth of files with findings of several kinds spread over them, plus a file of another framework. */
function mixedSuite(): string {
  const files: Record<string, string> = { 'support/cart.ts': HELPER, 'unit/sum.test.ts': VITEST };
  for (let i = 0; i < 2 * BATCH_SIZE + 7; i++) {
    files[`s-${two(i)}.spec.ts`] = i % 9 === 4 ? USES_HELPER : i % 5 === 2 ? WAITS : i === 33 ? BROKEN : good(String(i));
  }
  return suite(files);
}

const json = (r: ScoreResult): string => formatJson(r);

describe('QAG-287 S5b: batches', () => {
  it('are consecutive slices of the sorted file list, of a fixed size', () => {
    const files = Array.from({ length: 2 * BATCH_SIZE + 3 }, (_, i) => `/s/${two(i)}.spec.ts`);
    const batches = toBatches(files);
    assert.deepEqual(batches.map((b) => b.length), [BATCH_SIZE, BATCH_SIZE, 3]);
    assert.deepEqual(batches.flat(), files);
    assert.deepEqual(toBatches([]), []);
  });

  it('the default heap limit is the fixed constant, not a share of the host memory', () => {
    assert.equal(DEFAULT_MAX_HEAP_MB, 4608);
    assert.equal(DEFAULT_MAX_HEAP_MB % 512, 0);
  });
});

describe('QAG-287 S5b: the worker gives the in-process result', () => {
  it('a suite of 3 batches (helper scope, triage, a parse error, another framework): the JSON is byte-identical', async () => {
    const dir = mixedSuite();
    const inProcess = await scorePaths({ paths: [dir], cwd: dir, isolate: false });
    const isolated = await scorePaths({ paths: [dir], cwd: dir });
    assert.equal(json(isolated), json(inProcess));
    // The suite exercises what it says it does.
    assert.equal(isolated.status, 'partial');
    assert.deepEqual(isolated.coverage?.skipped.map((s) => [s.file, s.reason]), [['s-33.spec.ts', 'parse-error']]);
    assert.deepEqual(isolated.skippedFiles, ['unit/sum.test.ts']);
    assert.ok((isolated.coverage?.filesScored ?? 0) > 2 * BATCH_SIZE);
    const rules = new Set(isolated.findings.map((f) => f.rule));
    for (const rule of ['playwright/no-wait-for-timeout', 'playwright/expect-expect', 'playwright-score/parse-error']) {
      assert.ok(rules.has(rule), `no ${rule} finding: ${[...rules].join(', ')}`);
    }
  });

  it('the repository fixtures, scored both ways (a directory, and every cell fixture as an explicit file): the JSON is byte-identical', async () => {
    const root = packageRoot();
    const cells: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) cells.push(p);
      }
    };
    walk(path.join(root, 'tests', 'fixtures', 'cells'));
    for (const paths of [[path.join(root, 'fixtures')], cells.sort()]) {
      const inProcess = await scorePaths({ paths, cwd: root, isolate: false });
      const isolated = await scorePaths({ paths, cwd: root });
      assert.equal(json(isolated), json(inProcess));
      assert.ok((isolated.coverage?.filesFound ?? 0) > BATCH_SIZE, `a single batch: ${isolated.coverage?.filesFound} files`);
    }
  });

  it('a single file (one batch) and an explicit file list', async () => {
    const dir = mixedSuite();
    for (const paths of [[path.join(dir, 's-04.spec.ts')], [path.join(dir, 's-33.spec.ts'), path.join(dir, 's-02.spec.ts')]]) {
      const inProcess = await scorePaths({ paths, cwd: dir, isolate: false });
      const isolated = await scorePaths({ paths, cwd: dir });
      assert.equal(json(isolated), json(inProcess));
    }
  });
});

describe('QAG-287 S5b: a limit skips files into coverage, and nothing else', () => {
  it('the time limit has passed before the analysis starts: every file is skipped as deadline, not-scored', async () => {
    const dir = mixedSuite();
    const reference = await scorePaths({ paths: [dir], cwd: dir });
    const r = await scorePaths({ paths: [dir], cwd: dir, threshold: 0, maxSeconds: 0.001 });
    assert.equal(r.status, 'not-scored');
    assert.equal(r.reason, 'limit-reached');
    assert.equal(r.pass, false);
    assert.equal(r.score, 0);
    assert.equal(r.coverage?.filesFound, reference.coverage?.filesFound);
    assert.equal(r.coverage?.filesScored, 0);
    assert.equal(r.coverage?.testsCounted, 0);
    assert.equal(r.coverage?.skipped.length, reference.coverage?.filesFound);
    assert.deepEqual([...new Set(r.coverage?.skipped.map((s) => `${s.reason}|${s.detail}`))], ['deadline|time limit 0.001 s']);
    assert.deepEqual(r.findings, []);
    // Classification is untouched: the file of another framework is where it was.
    assert.deepEqual(r.skippedFiles, reference.skippedFiles);
    assert.match(formatText(r), /^Not scored: The time limit was reached before any test was scored\.$/m);
    assert.match(formatText(r), /time limit reached/);
  });

  it('the time limit passes while the worker is analysing: the worker is stopped, and the batch in flight and the later ones are skipped as deadline', async () => {
    // Batch 0: 20 small files. Batch 1: one dense file just under the 1 MB cap,
    // which takes many times the limit to analyse. Batch 2: one small file.
    const files: Record<string, string> = {};
    for (let i = 0; i < BATCH_SIZE; i++) files[`a-${two(i)}.spec.ts`] = good(`a${i}`);
    const head = good('dense');
    files['b-00.spec.ts'] = head + 'a;\n'.repeat(Math.floor((MAX_SOURCE_BYTES - head.length) / 3));
    for (let i = 1; i < BATCH_SIZE; i++) files[`b-${two(i)}.spec.ts`] = good(`b${i}`);
    files['c-00.spec.ts'] = good('c0');
    const dir = suite(files);
    const abs = Object.keys(files).sort().map((f) => path.join(dir, f));
    const input: AnalysisInput = {
      files: abs,
      sources: new Map(abs.map((f) => [f, fs.readFileSync(f, 'utf8')])),
      importedFiles: new Map(),
      filesBase: dir,
      importBoundary: dir,
      profile: 'standard',
      cwd: dir,
      assertFunctionNamesByFile: new Map(abs.map((f) => [f, []])),
      testAliasNames: [],
    };
    const started = performance.now();
    const out = await analyzeIsolated(input, { maxHeapMb: DEFAULT_MAX_HEAP_MB, time: startTimeLimit(3) });
    const elapsed = performance.now() - started;
    // Stopped at the limit, not after the dense file (which alone takes several times longer).
    assert.ok(elapsed >= 2900 && elapsed < 9000, `took ${Math.round(elapsed)} ms`);
    assert.ok(out.batches.length <= 1, `${out.batches.length} batches finished`);
    assert.deepEqual([...new Set(out.skipped.map((s) => `${s.reason}|${s.detail}`))], ['deadline|time limit 3 s']);
    assert.deepEqual(
      out.skipped.map((s) => s.file),
      abs.slice(out.batches.length * BATCH_SIZE)
    );
    assert.ok(out.skipped.some((s) => s.file.endsWith('b-00.spec.ts')) && out.skipped.some((s) => s.file.endsWith('c-00.spec.ts')));
  });

  it('no time limit by default: a run without maxSeconds is never cut short', async () => {
    const dir = mixedSuite();
    const r = await scorePaths({ paths: [dir], cwd: dir });
    assert.ok(!r.coverage?.skipped.some((s) => s.reason === 'deadline' || s.reason === 'worker-died'));
  });

  it('a heap limit no worker can start under: no throw; the files are skipped as worker-died, not-scored', async () => {
    const dir = mixedSuite();
    const reference = await scorePaths({ paths: [dir], cwd: dir });
    const r = await scorePaths({ paths: [dir], cwd: dir, threshold: 0, maxHeapMb: 4 });
    assert.equal(r.status, 'not-scored');
    assert.equal(r.reason, 'limit-reached');
    assert.equal(r.coverage?.filesScored, 0);
    assert.equal(r.coverage?.skipped.length, reference.coverage?.filesFound);
    assert.deepEqual([...new Set(r.coverage?.skipped.map((s) => s.reason))], ['worker-died']);
    assert.ok(r.coverage?.skipped.every((s) => s.detail !== undefined && !s.detail.includes('/')), 'a detail carries a path');
    assert.deepEqual(r.skippedFiles, reference.skippedFiles);
    assert.match(formatText(r), /^Not scored: The analysis ran out of memory or stopped before any test was scored\.$/m);
    assert.match(formatText(r), /analysis ran out of memory or stopped/);
  });

  it('isolate: false ignores the limits and scores in the calling thread', async () => {
    const dir = suite({ 'a.spec.ts': good('a') });
    const r = await scorePaths({ paths: [dir], cwd: dir, isolate: false, maxSeconds: 0.001, maxHeapMb: 4 });
    assert.equal(r.status, 'scored');
  });
});

// QAG-287 S5b: the time limit bounds the whole call. These tests replace the
// clock (an internal seam of src/isolate.ts, not an option and not a CLI flag)
// so that the limit passes at a chosen checkpoint, whatever the machine.
describe('QAG-287 S5b: the time limit passes mid-run, on an injected clock', () => {
  const realNow = clock.now;
  after(() => {
    clock.now = realNow;
  });
  /** Time stands still until the checkpoint `at` asks, and the limit has passed from then on. */
  const passAt = (at: string): string[] => {
    const asked: string[] = [];
    let t = 0;
    clock.now = (checkpoint) => {
      asked.push(checkpoint);
      if (checkpoint === at) t = 1e12;
      return t;
    };
    return asked;
  };
  const specNames = (): string[] => Array.from({ length: 2 * BATCH_SIZE + 7 }, (_, i) => `s-${two(i)}.spec.ts`);

  for (const k of [1, 2]) {
    it(`after batch ${k} of 3: partial; batches ${k + 1} to 3 are skipped as deadline; the kept findings are the in-process ones`, async () => {
      const dir = mixedSuite();
      clock.now = realNow;
      const reference = await scorePaths({ paths: [dir], cwd: dir, threshold: 0, isolate: false });
      assert.deepEqual(reference.coverage?.skipped.map((s) => `${s.file}|${s.reason}`), ['s-33.spec.ts|parse-error']);
      passAt(`batch:${k}`);
      const r = await scorePaths({ paths: [dir], cwd: dir, threshold: 0, maxSeconds: 1000 });
      clock.now = realNow;

      const names = specNames();
      const kept = new Set(names.slice(0, k * BATCH_SIZE));
      const later = names.slice(k * BATCH_SIZE);
      assert.equal(r.status, 'partial');
      assert.equal(r.reason, undefined);
      assert.equal(r.pass, false);
      // Exactly the later batches, as deadline; the unparsable file keeps its own reason when its batch was analysed.
      const expected = [
        ...later.map((file) => ({ file, reason: 'deadline', detail: 'time limit 1000 s' })),
        ...(kept.has('s-33.spec.ts') ? reference.coverage!.skipped : []),
      ].sort((a, b) => (a.file < b.file ? -1 : 1));
      assert.deepEqual(r.coverage?.skipped, expected);
      assert.equal(r.coverage?.filesFound, names.length);
      assert.equal(r.coverage?.filesScored, names.length - expected.length);
      // The kept batches: the same findings as the in-process run gives for those files.
      assert.deepEqual(r.findings, reference.findings.filter((f) => kept.has(f.file)));
      assert.ok(r.findings.length > 0);
      // Classification does not move.
      assert.deepEqual(r.skippedFiles, reference.skippedFiles);
      assert.deepEqual(r.skippedFiles, ['unit/sum.test.ts']);
    });
  }

  it('the CLI on the same clock: exit 1, never 2, and the same partial result', async () => {
    const dir = mixedSuite();
    const root = packageRoot();
    const preload = path.join(dir, '..', `${path.basename(dir)}-clock.mjs`);
    tmpDirs.push(preload);
    fs.writeFileSync(
      preload,
      `import { clock } from ${JSON.stringify(pathToFileURL(path.join(root, 'dist', 'isolate.js')).href)};\n` +
        `let t = 0;\nclock.now = (at) => { if (at === 'batch:1') t = 1e12; return t; };\n`
    );
    const args = ['--import', pathToFileURL(preload).href, path.join(root, 'dist', 'cli.js'), dir, '--format', 'json', '--threshold', '0', '--max-seconds', '1000'];
    const e = await promisify(execFile)(process.execPath, args, { maxBuffer: 64 * 1024 * 1024 }).then(
      () => undefined,
      (err: { code?: number; stdout?: string; stderr?: string }) => err
    );
    assert.equal(e?.code, 1, e?.stderr);
    const result = JSON.parse(e?.stdout ?? '') as ScoreResult;
    assert.equal(result.status, 'partial');
    assert.equal(result.coverage?.filesScored, BATCH_SIZE);
    assert.deepEqual(result.coverage?.skipped.map((s) => `${s.file}|${s.reason}`), specNames().slice(BATCH_SIZE).map((f) => `${f}|deadline`));
    assert.deepEqual(result.skippedFiles, ['unit/sum.test.ts']);
  });

  for (const step of ['helper-facts', 'import-graph', 'aliases', 'analysis-input', 'batch:0']) {
    it(`before the ${step} step: no later step starts; every file is skipped as deadline; not-scored, limit-reached`, async () => {
      const dir = mixedSuite();
      const asked = passAt(step);
      const r = await scorePaths({ paths: [dir], cwd: dir, threshold: 0, maxSeconds: 1000 });
      clock.now = realNow;
      // The clock is not read again once the limit has passed.
      assert.equal(asked[asked.length - 1], step);
      assert.equal(r.status, 'not-scored');
      assert.equal(r.reason, 'limit-reached');
      assert.equal(r.pass, false);
      assert.deepEqual(r.coverage?.skipped, specNames().map((file) => ({ file, reason: 'deadline', detail: 'time limit 1000 s' })));
      assert.deepEqual(r.findings, []);
      assert.deepEqual(r.skippedFiles, ['unit/sum.test.ts']);
    });
  }

  it('the checkpoints, in order: the start, each pre-pass step, each batch', async () => {
    const dir = mixedSuite();
    const asked = passAt('never');
    const r = await scorePaths({ paths: [dir], cwd: dir, maxSeconds: 1000 });
    clock.now = realNow;
    assert.equal(r.status, 'partial'); // s-33 only
    assert.deepEqual(asked.filter((a) => a !== 'timer'), ['start', 'helper-facts', 'import-graph', 'aliases', 'analysis-input', 'batch:0', 'batch:1', 'batch:2']);
  });

  it('with no time limit the clock is never read, in the worker path or in process', async () => {
    const dir = mixedSuite();
    clock.now = () => {
      throw new Error('the clock was read');
    };
    const isolated = await scorePaths({ paths: [dir], cwd: dir });
    const inProcess = await scorePaths({ paths: [dir], cwd: dir, isolate: false, maxSeconds: 5 });
    clock.now = realNow;
    assert.equal(json(isolated), json(inProcess));
  });

  // A timer delay above 2^31 - 1 ms is not a longer wait: Node turns it into 1 ms.
  for (const maxSeconds of [MAX_TIMER_MS / 1000 + 1, 99999999, Number.MAX_VALUE]) {
    it(`a time limit longer than one timer can hold (${maxSeconds} s) gives the result of a run with no limit`, async () => {
      const dir = mixedSuite();
      clock.now = realNow;
      const warnings: string[] = [];
      const onWarning = (w: Error): void => void warnings.push(w.name);
      process.on('warning', onWarning);
      try {
        const reference = await scorePaths({ paths: [dir], cwd: dir });
        const r = await scorePaths({ paths: [dir], cwd: dir, maxSeconds });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(json(r), json(reference));
        assert.ok(!r.coverage?.skipped.some((s) => s.reason === 'deadline'));
        assert.deepEqual(warnings, []);
      } finally {
        process.off('warning', onWarning);
      }
    });
  }

  it('the timer fires while the clock says the limit has not passed: it is set again, and nothing is skipped as deadline', async () => {
    const dir = mixedSuite();
    clock.now = realNow;
    const reference = await scorePaths({ paths: [dir], cwd: dir });
    // Time stands still: the 50 ms timer fires again and again during the analysis.
    const asked: string[] = [];
    clock.now = (checkpoint) => {
      asked.push(checkpoint);
      return 0;
    };
    const r = await scorePaths({ paths: [dir], cwd: dir, maxSeconds: 0.05 });
    clock.now = realNow;
    assert.equal(json(r), json(reference));
    assert.ok(asked.filter((a) => a === 'timer').length >= 3, `the timer asked ${asked.filter((a) => a === 'timer').length} times`);
  });

  it('limit-reached is only for a limit: no counted test without one stays no-counted-tests, and a counted test stays partial', async () => {
    const empty = suite({ 'a.spec.ts': '// nothing yet\n' });
    assert.equal((await scorePaths({ paths: [path.join(empty, 'a.spec.ts')], cwd: empty })).reason, 'no-counted-tests');
    const broken = suite({ 'a.spec.ts': BROKEN });
    assert.equal((await scorePaths({ paths: [broken], cwd: broken })).reason, 'no-counted-tests');
    assert.equal((await scorePaths({ paths: [path.join(empty, 'none')], cwd: empty })).reason, 'no-files');
  });
});
