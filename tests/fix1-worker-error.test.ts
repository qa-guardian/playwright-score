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
// with the execArgv). A patch made in this test's own thread would never reach the worker.
// - mode `batch`: the first batch that names the marked file throws on arrival.
// - mode `after-result`: the worker posts the result of the batch that names the marked file,
//   then dies of an uncaught error before it is sent another batch.
// QAG-287 FIX1 R1: the error comes on the worker's internal port, so 'error' can be read ahead of
// what the worker posted before it (its setup report, a batch result), or after. The driver
// forces each order (see its emit gate), so every test here pins one order exactly.

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const MARK = 'a-00.spec.ts';
const PRELOAD = `import fs from 'node:fs';
import path from 'node:path';
import { isMainThread, parentPort } from 'node:worker_threads';
const { PWSCORE_TEST_FAIL_FILE: file, PWSCORE_TEST_FAIL_MODE: mode, PWSCORE_TEST_DEAD_MARK: dead } = process.env;
const die = () => {
  fs.writeFileSync(dead, '');
  throw new Error('injected worker error');
};
if (!isMainThread && parentPort) {
  const on = parentPort.on.bind(parentPort);
  parentPort.on = (event, listener) =>
    on(event, event !== 'message' || mode !== 'batch' ? listener : (files) => {
      if (Array.isArray(files) && files.some((f) => typeof f === 'string' && path.basename(f) === file)) die();
      return listener(files);
    });
  const post = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (message, ...rest) => {
    post(message, ...rest);
    if (mode === 'after-result' && Array.isArray(message?.facts) && message.facts.some((f) => path.basename(f.rel) === file)) die();
  };
}
`;
const DRIVER = `import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
const [isolateUrl, indexUrl, dir, withScore] = process.argv.slice(2);
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
// Node reads a worker's internal port (its uncaught error) and its public port (its messages)
// separately, so the order the main thread sees them in depends on timing. The driver fixes the
// order of the FIRST worker (the one that dies) by holding events in Worker.prototype.emit, with
// no wait on wall time:
// - error-first: the worker's messages are held until its 'error' has been emitted.
// - result-first: its 'error' is held until a batch result has been emitted (or 'exit').
// - error-first-timer: error-first, and then every later event is held until the time limit's
//   timer has read the clock and seen the limit passed (the timer is a spy, see below).
// The driver also logs every batch posted to a worker (the first file of each).
const order = process.env.PWSCORE_TEST_ORDER ?? '';
const ids = new Map();
const held = [];
let errored = false;
let resultSeen = false;
let heldError;
let timerSeen = false;
let flush = () => {};
const posts = [];
const post = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (value, ...rest) {
  if (Array.isArray(value)) posts.push(path.basename(value[0]));
  return post.call(this, value, ...rest);
};
const emit = Worker.prototype.emit;
Worker.prototype.emit = function (event, ...args) {
  if (!ids.has(this)) ids.set(this, ids.size);
  if (!order || ids.get(this) !== 0) return emit.call(this, event, ...args);
  const go = (e, a) => emit.call(this, e, ...a);
  flush = () => {
    while (held.length) go(...held.shift());
  };
  if (event === 'error' && order === 'result-first' && !resultSeen) {
    heldError = args;
    return true;
  }
  if (event === 'exit' && heldError) {
    const e = heldError;
    heldError = undefined;
    go('error', e);
  }
  if (event === 'error') {
    errored = true;
    go(event, args);
    if (order === 'error-first') flush();
    return true;
  }
  if (order !== 'result-first' && !errored && event === 'message') {
    held.push([event, args]);
    return true;
  }
  if (order === 'error-first-timer' && errored && (event === 'message' || event === 'exit') && !timerSeen) {
    held.push([event, args]);
    return true;
  }
  const r = go(event, args);
  if (event === 'message' && args[0] && args[0].facts && order === 'result-first') {
    resultSeen = true;
    if (heldError) {
      const e = heldError;
      heldError = undefined;
      go('error', e);
    }
  }
  return r;
};
// The timer's clock reads: with the timer order the limit "passes" once, after the dead worker's
// error was seen, and only then the held events go on (in a later turn, so the timer's own
// callback has finished first).
const time = order === 'error-first-timer'
  ? {
      msLeft: (at) => (at === 'timer' ? 2 : Infinity),
      passed: (at) => {
        if (at !== 'timer' || !errored || timerSeen) return false;
        timerSeen = true;
        setImmediate(() => flush());
        return true;
      },
    }
  : startTimeLimit(undefined);
const setups = [];
const out = await analyzeIsolated(input, { maxHeapMb: DEFAULT_MAX_HEAP_MB, time, onWorkerSetup: (s) => setups.push(s) });
const postsAfter = [...posts];
const r = withScore === 'score' ? await scorePaths({ paths: [dir], cwd: dir }) : undefined;
process.stdout.write(JSON.stringify({
  setups: setups.length,
  posts: postsAfter,
  batches: out.batches.map((b) => b.facts.map((f) => f.rel)),
  skipped: out.skipped.map((s) => [path.basename(s.file), s.reason, s.detail]),
  status: r?.status ?? null,
  reason: r?.reason ?? null,
  filesScored: r?.coverage.filesScored ?? null,
  testsCounted: r?.coverage.testsCounted ?? null,
  coverageSkipped: r ? r.coverage.skipped.map((s) => [s.file, s.reason, s.detail]) : null,
}));
`;

type Out = {
  setups: number;
  posts: string[];
  batches: string[][];
  skipped: Array<[string, string, string]>;
  status: string | null;
  reason: string | null;
  filesScored: number | null;
  testsCounted: number | null;
  coverageSkipped: Array<[string, string, string]> | null;
};

const good = (n: string): string => `import { test, expect } from '@playwright/test';

test('opens page ${n}', async ({ page }) => {
  await page.goto('/p/${n}');
  await expect(page.getByRole('heading', { name: 'Page ${n}' })).toBeVisible();
});
`;
const two = (i: number): string => String(i).padStart(2, '0');

// Three batches: a-00..a-19 (holds the marked file), a-20..a-39, a-40..a-44.
const names = Array.from({ length: 2 * BATCH_SIZE + 5 }, (_, i) => `a-${two(i)}.spec.ts`);

type Order = 'error-first' | 'result-first' | 'error-first-timer';

async function run(mode: 'batch' | 'after-result', order: Order, withScore: boolean): Promise<Out> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-worker-error-'));
  tmpDirs.push(tmp);
  const dir = path.join(tmp, 'suite');
  fs.mkdirSync(dir);
  for (const [i, name] of names.entries()) fs.writeFileSync(path.join(dir, name), good(String(i)));
  fs.writeFileSync(path.join(tmp, 'preload.mjs'), PRELOAD);
  fs.writeFileSync(path.join(tmp, 'driver.mjs'), DRIVER);
  const src = new URL('../src/', import.meta.url);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [`--import=${pathToFileURL(path.join(tmp, 'preload.mjs')).href}`, path.join(tmp, 'driver.mjs'), new URL('isolate.js', src).href, new URL('index.js', src).href, dir, withScore ? 'score' : ''],
    {
      env: { ...process.env, PWSCORE_TEST_FAIL_FILE: MARK, PWSCORE_TEST_FAIL_MODE: mode, PWSCORE_TEST_DEAD_MARK: path.join(tmp, 'dead'), PWSCORE_TEST_ORDER: order },
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  return JSON.parse(stdout) as Out;
}

const batch = (i: number): string[] => names.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
const first = (i: number): string => batch(i)[0];

describe('QAG-287 FIX1 R2: a worker death that is not the heap limit', () => {
  it('skips only the batch in flight as worker-died; a second worker is set up and scores every later batch', async () => {
    const out = await run('batch', 'error-first', true);
    const later = names.slice(BATCH_SIZE);
    // R1: the dead worker's setup report was posted before its error, and is not dropped.
    assert.equal(out.setups, 2, 'a fresh worker was not set up after the error');
    assert.deepEqual(out.batches, [batch(1), batch(2)]);
    assert.deepEqual(out.skipped.map(([f, reason]) => `${f}|${reason}`), batch(0).map((f) => `${f}|worker-died`));
    for (const [, , detail] of out.skipped) assert.match(detail, /^worker error( \([A-Za-z]+\))?$/);
    // The batch that killed its worker as that worker's first is never sent again.
    assert.deepEqual(out.posts, [first(0), first(1), first(2)]);
    // scorePaths, through the same worker: partial with the later batches scored.
    assert.equal(out.status, 'partial');
    assert.equal(out.reason, null);
    assert.equal(out.filesScored, later.length);
    assert.equal(out.testsCounted, later.length);
    assert.deepEqual(out.coverageSkipped!.map(([f, reason]) => `${f}|${reason}`), batch(0).map((f) => `${f}|worker-died`));
  });

  it('error read before the result: the result is kept, no batch is sent to the dying worker, nothing is skipped', async () => {
    const out = await run('after-result', 'error-first', false);
    assert.equal(out.setups, 2, 'a fresh worker was not set up after the error');
    assert.deepEqual(out.batches, [batch(0), batch(1), batch(2)]);
    assert.deepEqual(out.skipped, []);
    // Each batch posted exactly once: the `!death` guard kept batch 1 from the dying worker.
    assert.deepEqual(out.posts, [first(0), first(1), first(2)]);
  });

  it('QAG-287 3.0.1: result read before the error: the batch sent meanwhile is handed to the fresh worker, nothing is skipped', async () => {
    const out = await run('after-result', 'result-first', false);
    assert.equal(out.setups, 2, 'a fresh worker was not set up after the error');
    assert.deepEqual(out.batches, [batch(0), batch(1), batch(2)]);
    assert.deepEqual(out.skipped, []);
    // Batch 1 went to the dying worker and again, once, to the fresh one as its first batch.
    assert.deepEqual(out.posts, [first(0), first(1), first(1), first(2)]);
  });

  it('QAG-287 3.0.1: the time limit passing between the death and its exit keeps the posted result and stops nothing', async () => {
    const out = await run('after-result', 'error-first-timer', false);
    assert.deepEqual(out.batches, [batch(0), batch(1), batch(2)]);
    assert.deepEqual(out.skipped, []);
    assert.equal(out.setups, 2);
  });
});
