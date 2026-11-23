import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_SOURCE_BYTES } from '../src/fs-util.js';
import { createHeapGuard } from '../src/heap-guard.js';
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
function cli(args: string[], nodeOptions: string | undefined, execArgv: string[] = []): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env };
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
