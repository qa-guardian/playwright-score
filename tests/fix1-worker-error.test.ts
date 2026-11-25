import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { BATCH_SIZE } from '../src/isolate.js';

// QAG-287 FIX1 R2: a worker that dies of an error that is not the heap limit loses only the
// batch it had; a fresh worker takes the later batches (src/isolate.ts, analyzeIsolated). The
// error is injected in the worker thread by a preload (`--import`, which every worker inherits
// with the execArgv): the first batch that names the marked file throws there. A patch made in
// this test's own thread would never reach the worker.

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const MARK = 'a-00.spec.ts';
const PRELOAD = `import path from 'node:path';
import { isMainThread, parentPort } from 'node:worker_threads';
if (!isMainThread && parentPort) {
  const on = parentPort.on.bind(parentPort);
  parentPort.on = (event, listener) =>
    on(event, event !== 'message' ? listener : (files) => {
      if (Array.isArray(files) && files.some((f) => typeof f === 'string' && path.basename(f) === process.env.PWSCORE_TEST_FAIL_FILE)) {
        throw new Error('injected worker error');
      }
      return listener(files);
    });
}
`;
const DRIVER = `import fs from 'node:fs';
import path from 'node:path';
const [isolateUrl, indexUrl, dir] = process.argv.slice(2);
const { analyzeIsolated, startTimeLimit, DEFAULT_MAX_HEAP_MB } = await import(isolateUrl);
const { scorePaths } = await import(indexUrl);
const abs = fs.readdirSync(dir).sort().map((f) => path.join(dir, f));
const input = {
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
const setups = [];
const out = await analyzeIsolated(input, { maxHeapMb: DEFAULT_MAX_HEAP_MB, time: startTimeLimit(undefined), onWorkerSetup: (s) => setups.push(s) });
const r = await scorePaths({ paths: [dir], cwd: dir });
process.stdout.write(JSON.stringify({
  setups: setups.length,
  batches: out.batches.map((b) => b.facts.map((f) => f.rel)),
  skipped: out.skipped.map((s) => [path.basename(s.file), s.reason, s.detail]),
  status: r.status,
  reason: r.reason ?? null,
  filesScored: r.coverage.filesScored,
  testsCounted: r.coverage.testsCounted,
  coverageSkipped: r.coverage.skipped.map((s) => [s.file, s.reason, s.detail]),
}));
`;

const good = (n: string): string => `import { test, expect } from '@playwright/test';

test('opens page ${n}', async ({ page }) => {
  await page.goto('/p/${n}');
  await expect(page.getByRole('heading', { name: 'Page ${n}' })).toBeVisible();
});
`;
const two = (i: number): string => String(i).padStart(2, '0');

describe('QAG-287 FIX1 R2: a worker death that is not the heap limit', () => {
  it('skips only the batch in flight as worker-died; a second worker is set up and scores every later batch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-worker-error-'));
    tmpDirs.push(tmp);
    const dir = path.join(tmp, 'suite');
    fs.mkdirSync(dir);
    // Three batches: a-00..a-19 (holds the marked file), a-20..a-39, a-40..a-44.
    const names = Array.from({ length: 2 * BATCH_SIZE + 5 }, (_, i) => `a-${two(i)}.spec.ts`);
    for (const [i, name] of names.entries()) fs.writeFileSync(path.join(dir, name), good(String(i)));
    fs.writeFileSync(path.join(tmp, 'preload.mjs'), PRELOAD);
    fs.writeFileSync(path.join(tmp, 'driver.mjs'), DRIVER);
    const src = new URL('../src/', import.meta.url);
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [`--import=${pathToFileURL(path.join(tmp, 'preload.mjs')).href}`, path.join(tmp, 'driver.mjs'), new URL('isolate.js', src).href, new URL('index.js', src).href, dir],
      { env: { ...process.env, PWSCORE_TEST_FAIL_FILE: MARK }, maxBuffer: 16 * 1024 * 1024 }
    );
    const out = JSON.parse(stdout) as {
      setups: number;
      batches: string[][];
      skipped: Array<[string, string, string]>;
      status: string;
      reason: string | null;
      filesScored: number;
      testsCounted: number;
      coverageSkipped: Array<[string, string, string]>;
    };
    const first = names.slice(0, BATCH_SIZE);
    const later = names.slice(BATCH_SIZE);
    assert.equal(out.setups, 2, 'a fresh worker was not set up after the error');
    assert.deepEqual(out.batches, [names.slice(BATCH_SIZE, 2 * BATCH_SIZE), names.slice(2 * BATCH_SIZE)]);
    assert.deepEqual(out.skipped.map(([f, reason]) => `${f}|${reason}`), first.map((f) => `${f}|worker-died`));
    for (const [, , detail] of out.skipped) assert.match(detail, /^worker error( \([A-Za-z]+\))?$/);
    // scorePaths, through the same worker: partial with the later batches scored.
    assert.equal(out.status, 'partial');
    assert.equal(out.reason, null);
    assert.equal(out.filesScored, later.length);
    assert.equal(out.testsCounted, later.length);
    assert.deepEqual(out.coverageSkipped.map(([f, reason]) => `${f}|${reason}`), first.map((f) => `${f}|worker-died`));
  });
});
