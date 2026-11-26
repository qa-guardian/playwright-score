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
// QAG-287 FIX1 R1: the error comes on the worker's internal port, so when the main thread is
// busy while the worker dies, 'error' can be dispatched ahead of what the worker posted before
// it (its setup report, a batch result). The driver forces that order (see its 'online' hold).

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
    if (mode === 'after-result' && Array.isArray(message?.facts) && message.facts.some((f) => path.basename(f.rel) === file)) setImmediate(die);
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
// Node reads a worker's internal port (where 'online' and its uncaught error come) and its
// public port (its messages) separately, and goes on reading the internal port while messages
// come in. So a thread busy in an 'online' listener while the worker posts and dies reads the
// error before the earlier messages: hold here until the first worker is dead (and a little
// longer, for its error to be posted) to make that order certain.
let held = false;
const emit = Worker.prototype.emit;
Worker.prototype.emit = function (event, ...args) {
  if (event === 'online' && !held) {
    held = true;
    const hold = new Int32Array(new SharedArrayBuffer(4));
    const giveUp = Date.now() + 60_000;
    while (!fs.existsSync(process.env.PWSCORE_TEST_DEAD_MARK) && Date.now() < giveUp) Atomics.wait(hold, 0, 0, 5);
    Atomics.wait(hold, 0, 0, 500);
  }
  return emit.call(this, event, ...args);
};
const setups = [];
const out = await analyzeIsolated(input, { maxHeapMb: DEFAULT_MAX_HEAP_MB, time: startTimeLimit(undefined), onWorkerSetup: (s) => setups.push(s) });
const r = withScore === 'score' ? await scorePaths({ paths: [dir], cwd: dir }) : undefined;
process.stdout.write(JSON.stringify({
  setups: setups.length,
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

async function run(mode: 'batch' | 'after-result', withScore: boolean): Promise<Out> {
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
    { env: { ...process.env, PWSCORE_TEST_FAIL_FILE: MARK, PWSCORE_TEST_FAIL_MODE: mode, PWSCORE_TEST_DEAD_MARK: path.join(tmp, 'dead') }, maxBuffer: 16 * 1024 * 1024 }
  );
  return JSON.parse(stdout) as Out;
}

describe('QAG-287 FIX1 R2: a worker death that is not the heap limit', () => {
  it('skips only the batch in flight as worker-died; a second worker is set up and scores every later batch', async () => {
    const out = await run('batch', true);
    const first = names.slice(0, BATCH_SIZE);
    const later = names.slice(BATCH_SIZE);
    // R1: the dead worker's setup report was posted before its error, and is not dropped.
    assert.equal(out.setups, 2, 'a fresh worker was not set up after the error');
    assert.deepEqual(out.batches, [names.slice(BATCH_SIZE, 2 * BATCH_SIZE), names.slice(2 * BATCH_SIZE)]);
    assert.deepEqual(out.skipped.map(([f, reason]) => `${f}|${reason}`), first.map((f) => `${f}|worker-died`));
    for (const [, , detail] of out.skipped) assert.match(detail, /^worker error( \([A-Za-z]+\))?$/);
    // scorePaths, through the same worker: partial with the later batches scored.
    assert.equal(out.status, 'partial');
    assert.equal(out.reason, null);
    assert.equal(out.filesScored, later.length);
    assert.equal(out.testsCounted, later.length);
    assert.deepEqual(out.coverageSkipped!.map(([f, reason]) => `${f}|${reason}`), first.map((f) => `${f}|worker-died`));
  });

  it('QAG-287 FIX1 R1: keeps a batch whose result the worker posted before it died, and a fresh worker scores the rest', async () => {
    const out = await run('after-result', false);
    assert.equal(out.setups, 2, 'a fresh worker was not set up after the error');
    // The result posted before the error is kept, not skipped as worker-died.
    assert.deepEqual(out.batches[0], names.slice(0, BATCH_SIZE));
    assert.deepEqual(out.batches.at(-1), names.slice(2 * BATCH_SIZE));
    assert.ok(!out.skipped.some(([f]) => names.slice(0, BATCH_SIZE).includes(f)), 'a batch scored before the death was skipped');
    // The error is read first (the driver's hold), so no batch is sent to the dying worker; at
    // most that batch would be skipped if the hold ever missed the error.
    const second = names.slice(BATCH_SIZE, 2 * BATCH_SIZE);
    const lost = out.skipped.map(([f, reason]) => `${f}|${reason}`);
    assert.ok(lost.length === 0 || lost.join() === second.map((f) => `${f}|worker-died`).join(), `unexpected skips: ${lost.join()}`);
    assert.deepEqual([...out.batches.flat(), ...out.skipped.map(([f]) => f)].sort(), names);
  });
});
