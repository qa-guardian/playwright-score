import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_SOURCE_BYTES } from '../src/fs-util.js';
import { createHeapGuard, effectiveHeapLimitMb } from '../src/heap-guard.js';
import { BATCH_SIZE } from '../src/isolate.js';
import type { ScoreResult } from '../src/types.js';

// QAG-287 S5c: the heap limit holds when the process runs with
// --max-old-space-size. The engine then ignores the worker's own limit, and
// the worker's heap guard (src/heap-guard.ts) ends it instead.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const two = (i: number): string => String(i).padStart(2, '0');
const good = (n: string): string => `import { test, expect } from '@playwright/test';

test('opens page ${n}', async ({ page }) => {
  await page.goto('/p/${n}');
  await expect(page.getByRole('heading', { name: 'Page ${n}' })).toBeVisible();
});
`;

/** Batch 0: 20 small files. Batch 1: one file whose syntax tree alone is far over a 256 MB heap, and one small file. */
function suiteWithOneHeavyFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-heap-'));
  tmpDirs.push(dir);
  for (let i = 0; i < BATCH_SIZE; i++) fs.writeFileSync(path.join(dir, `a-${two(i)}.spec.ts`), good(`a${i}`));
  const head = good('dense');
  fs.writeFileSync(path.join(dir, 'b-00.spec.ts'), head + 'a;\n'.repeat(Math.floor((MAX_SOURCE_BYTES - head.length) / 3)));
  fs.writeFileSync(path.join(dir, 'b-01.spec.ts'), good('b1'));
  return dir;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** The CLI in a child process, with exactly the engine flags given (none inherited). */
function cli(
  args: string[],
  nodeOptions: string | undefined,
  execArgv: string[] = [],
  extraEnv: Record<string, string> = {}
): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.NODE_OPTIONS;
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  const argv = [...execArgv, path.join(packageRoot(), 'dist', 'cli.js'), ...args, '--format', 'json', '--threshold', '0'];
  return new Promise((resolve) => {
    execFile(process.execPath, argv, { env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? ((error as { code?: number }).code ?? -1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

const skips = (run: Run): string[] =>
  ((JSON.parse(run.stdout) as ScoreResult).coverage?.skipped ?? []).map((s) => `${s.file}|${s.reason}|${s.detail}`);

/**
 * A flag below the limit, for the suite with the heavy file: the worker cannot
 * hold that file under it, while the main thread, which parses the file too,
 * can. Measured on node 22, each twice: flags of 704 to 1536 MB end the worker
 * alone; 640 MB and below end the whole process, because the flag is the main
 * thread's limit too. At 1024 MB a worker once held the file under load (all
 * files scored), so the flag sits low in that band: furthest from what the
 * worker needs, still 128 MB over the lowest rung the main thread held.
 */
const FLAG_MB = 832;

describe('QAG-287 S5c: the heap limit holds under --max-old-space-size', () => {
  const heavy = ['b-00.spec.ts|worker-died|heap limit 256 MB', 'b-01.spec.ts|worker-died|heap limit 256 MB'];

  it('NODE_OPTIONS=--max-old-space-size=3072 and --max-heap-mb 256: the batch with the heavy file is skipped as worker-died, the rest is scored', async () => {
    const dir = suiteWithOneHeavyFile();
    const flagged = await cli([dir, '--max-heap-mb', '256'], '--max-old-space-size=3072');
    assert.equal(flagged.code, 1, flagged.stderr);
    assert.equal(flagged.stderr, '');
    const result = JSON.parse(flagged.stdout) as ScoreResult;
    assert.equal(result.status, 'partial');
    assert.equal(result.coverage?.filesScored, BATCH_SIZE);
    assert.deepEqual(skips(flagged), heavy);

    // The same limit with no flag (the engine's own limit ends the worker): the same output, byte for byte.
    const plain = await cli([dir, '--max-heap-mb', '256'], undefined);
    assert.equal(plain.code, 1, plain.stderr);
    assert.deepEqual(skips(plain), heavy);
    assert.equal(flagged.stdout, plain.stdout);

    // The flag on the command line instead of in the environment.
    const onCommandLine = await cli([dir, '--max-heap-mb', '256'], undefined, ['--max-old-space-size=3072']);
    assert.equal(onCommandLine.code, 1, onCommandLine.stderr);
    assert.equal(onCommandLine.stdout, plain.stdout);
  });

  it('a suite that fits: the flag and an armed guard change nothing in the output', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-heap-'));
    tmpDirs.push(dir);
    for (let i = 0; i < BATCH_SIZE + 3; i++) fs.writeFileSync(path.join(dir, `s-${two(i)}.spec.ts`), good(String(i)));
    const plain = await cli([dir], undefined);
    const flagged = await cli([dir, '--max-heap-mb', '256'], '--max-old-space-size=3072');
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(flagged.code, 0, flagged.stderr);
    assert.equal(flagged.stderr, '');
    assert.equal((JSON.parse(plain.stdout) as ScoreResult).status, 'scored');
    assert.equal(flagged.stdout, plain.stdout);
  });
});

describe('QAG-287 S5c: when the guard is armed, and when it ends the worker', () => {
  const guard = (maxHeapMb: number, heapSizeLimitMb: number, readings: number[]): { armed: boolean; ended: number; read: number } => {
    const state = { armed: false, ended: 0, read: 0 };
    const g = createHeapGuard(maxHeapMb, heapSizeLimitMb, () => readings[Math.min(state.read++, readings.length - 1)], () => void state.ended++);
    state.armed = g.armed;
    g.check();
    return state;
  };

  it('not armed when the engine holds the limit (the limit plus the young generation), or a lower one', () => {
    assert.deepEqual(guard(256, 256 + 48, [9999]), { armed: false, ended: 0, read: 0 });
    assert.deepEqual(guard(4608, 3072 + 48, [9999]), { armed: false, ended: 0, read: 0 });
  });

  it('armed when the worker starts with more heap than its limit allows for', () => {
    assert.equal(guard(256, 3072 + 48, [10]).armed, true);
    assert.equal(guard(64, 256 + 48, [10]).armed, true);
  });

  it('armed: under the limit nothing happens; over it after a collection the worker is ended; garbage alone does not end it', () => {
    assert.deepEqual(guard(256, 3120, [200]), { armed: true, ended: 0, read: 1 });
    assert.deepEqual(guard(256, 3120, [256]), { armed: true, ended: 0, read: 1 });
    assert.deepEqual(guard(256, 3120, [300, 290]), { armed: true, ended: 1, read: 2 });
    assert.deepEqual(guard(256, 3120, [300, 120]), { armed: true, ended: 0, read: 2 });
  });
});

describe('QAG-287 S5c: a worker out of heap is reported with the limit the engine held it to', () => {
  it('no flag, or a flag at or above the limit: the limit given; a lower flag: the flag', () => {
    assert.equal(effectiveHeapLimitMb(4608, [], undefined), 4608);
    assert.equal(effectiveHeapLimitMb(4608, [], ''), 4608);
    assert.equal(effectiveHeapLimitMb(256, [], '--max-old-space-size=3072'), 256);
    assert.equal(effectiveHeapLimitMb(256, ['--max-old-space-size=256'], undefined), 256);
    assert.equal(effectiveHeapLimitMb(4608, [], '--max-old-space-size=3072'), 3072);
    assert.equal(effectiveHeapLimitMb(4608, [], '--enable-source-maps  --max_old_space_size=2048 --no-warnings'), 2048);
    assert.equal(effectiveHeapLimitMb(4608, ['--max-old-space-size=1024'], undefined), 1024);
    assert.equal(effectiveHeapLimitMb(4608, ['--max-old-space-size', '1024'], undefined), 1024);
    // The command line wins over the environment, and the last one given wins.
    assert.equal(effectiveHeapLimitMb(4608, ['--max-old-space-size=1024'], '--max-old-space-size=512'), 1024);
    assert.equal(effectiveHeapLimitMb(4608, ['--max-old-space-size=512', '--max-old-space-size=8192'], undefined), 4608);
    // Not a flag value the engine takes: ignored.
    assert.equal(effectiveHeapLimitMb(4608, ['--max-old-space-size=abc'], '--max-old-space-size=0'), 4608);
    assert.equal(effectiveHeapLimitMb(4608, ['--max-semi-space-size=16'], undefined), 4608);
  });

  it('NODE_OPTIONS=--max-old-space-size=FLAG_MB below --max-heap-mb: the worker ends at the flag, and the detail names it', async () => {
    const dir = suiteWithOneHeavyFile();
    const run = await cli([dir, '--max-heap-mb', '2048'], `--max-old-space-size=${FLAG_MB}`);
    assert.equal(run.code, 1, run.stderr);
    assert.equal(run.stderr, '');
    const result = JSON.parse(run.stdout) as ScoreResult;
    assert.equal(result.status, 'partial');
    assert.equal(result.coverage?.filesScored, BATCH_SIZE);
    assert.deepEqual(skips(run), [
      `b-00.spec.ts|worker-died|heap limit ${FLAG_MB} MB`,
      `b-01.spec.ts|worker-died|heap limit ${FLAG_MB} MB`,
    ]);
    // On the command line, the same.
    const onCommandLine = await cli([dir, '--max-heap-mb', '2048'], undefined, [`--max-old-space-size=${FLAG_MB}`]);
    assert.equal(onCommandLine.stdout, run.stdout);
  });
});

describe('QAG-287 S5c: the collector is optional, and reaching it leaves nothing behind', () => {
  // Loaded into every thread of the child before anything else: it records each
  // engine-flag change, can refuse them, and reports a `gc` global at exit.
  const preload = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-gc-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'preload.mjs');
    fs.writeFileSync(
      file,
      `import v8 from 'node:v8';
import fs from 'node:fs';
import { isMainThread } from 'node:worker_threads';
const log = process.env.PWSCORE_TEST_GC_LOG;
const who = isMainThread ? 'main' : 'worker';
const real = v8.setFlagsFromString;
v8.setFlagsFromString = (flag) => {
  fs.appendFileSync(log, who + ' flag ' + flag + '\\n');
  if (process.env.PWSCORE_TEST_GC_MODE === 'refuse') throw new Error('refused');
  return real(flag);
};
process.on('exit', () => {
  if (typeof globalThis.gc !== 'undefined') fs.appendFileSync(log, who + ' GLOBAL\\n');
});
`
    );
    return file;
  };
  const withPreload = async (
    args: string[],
    flags: string,
    mode: 'record' | 'refuse',
    execArgv: string[] = []
  ): Promise<{ run: Run; log: string[] }> => {
    const file = preload();
    const log = path.join(path.dirname(file), 'gc.log');
    fs.writeFileSync(log, '');
    const env = { PWSCORE_TEST_GC_LOG: log, PWSCORE_TEST_GC_MODE: mode };
    const run = await cli(args, `--import=${file} ${flags}`.trim(), execArgv, env);
    return { run, log: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  };
  const fits = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-heap-'));
    tmpDirs.push(dir);
    for (let i = 0; i < BATCH_SIZE + 3; i++) fs.writeFileSync(path.join(dir, `s-${two(i)}.spec.ts`), good(String(i)));
    return dir;
  };

  it('reached: the flag is switched on and off again, and no gc global is left in any thread', async () => {
    const dir = suiteWithOneHeavyFile();
    const plain = await cli([dir, '--max-heap-mb', '256'], '--max-old-space-size=3072');
    const { run, log } = await withPreload([dir, '--max-heap-mb', '256'], '--max-old-space-size=3072', 'record');
    assert.equal(run.stderr, '');
    assert.equal(run.stdout, plain.stdout);
    // Main thread (memory handed back before the worker) and worker (the guard's second reading): once each, on then off.
    assert.deepEqual(log.filter((l) => l.startsWith('main')), ['main flag --expose-gc', 'main flag --no-expose-gc']);
    assert.ok(log.includes('worker flag --expose-gc') && log.includes('worker flag --no-expose-gc'), log.join(';'));
    assert.equal(log.filter((l) => l.endsWith('GLOBAL')).length, 0, log.join(';'));
    assert.equal(log.filter((l) => l.endsWith('--expose-gc')).length, log.filter((l) => l.endsWith('--no-expose-gc')).length);
  });

  it('not reachable (the engine refuses the flag): the JSON is the same, byte for byte, with and without a limit hit', async () => {
    const small = fits();
    const smallPlain = await cli([small], undefined);
    const smallRefused = await withPreload([small], '', 'refuse');
    assert.equal(smallRefused.run.code, 0, smallRefused.run.stderr);
    assert.equal(smallRefused.run.stderr, '');
    assert.equal(smallRefused.run.stdout, smallPlain.stdout);
    assert.deepEqual(smallRefused.log, ['main flag --expose-gc']); // asked once, refused, never asked again

    const heavy = suiteWithOneHeavyFile();
    const heavyPlain = await cli([heavy, '--max-heap-mb', '256'], '--max-old-space-size=3072');
    const heavyRefused = await withPreload([heavy, '--max-heap-mb', '256'], '--max-old-space-size=3072', 'refuse');
    assert.equal(heavyRefused.run.code, 1, heavyRefused.run.stderr);
    assert.equal(heavyRefused.run.stderr, '');
    assert.equal((JSON.parse(heavyRefused.run.stdout) as ScoreResult).status, 'partial');
    assert.equal(heavyRefused.run.stdout, heavyPlain.stdout);
    assert.ok(heavyRefused.log.includes('worker flag --expose-gc'), heavyRefused.log.join(';'));
    assert.ok(!heavyRefused.log.some((l) => l.endsWith('--no-expose-gc')), heavyRefused.log.join(';'));
  });

  it('a process started with --expose-gc: its collector is used, and no engine flag is touched', async () => {
    const dir = suiteWithOneHeavyFile();
    const plain = await cli([dir, '--max-heap-mb', '256'], '--max-old-space-size=3072');
    const { run, log } = await withPreload([dir, '--max-heap-mb', '256'], '--max-old-space-size=3072', 'record', ['--expose-gc']);
    assert.equal(run.stderr, '');
    assert.equal(run.stdout, plain.stdout);
    assert.deepEqual(log.filter((l) => l.includes(' flag ')), []);
  });
});
