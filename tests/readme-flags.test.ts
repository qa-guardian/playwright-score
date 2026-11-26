import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FLAGS } from '../src/cli-args.js';
import { DIFF_FLAGS } from '../src/diff/run.js';

// The README documents the CLI: every option `--help` prints is in the README, and every
// long flag the README names is an option the CLI accepts.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'README.md')) && fs.existsSync(path.join(dir, 'bin'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

/** The option names of the Options block of `--help`: lines that start with two spaces and a dash. */
export function helpOptions(help: string): string[] {
  const block = help.split(/^Options:\n/m)[1]?.split(/\n\n/)[0] ?? '';
  const names: string[] = [];
  for (const m of block.matchAll(/^ {2}(-[\w-]+(?:, -[\w-]+)*)/gm)) names.push(...m[1]!.split(', '));
  return names;
}

/** Long flags named in a markdown text (`--x`, not part of a longer word). */
export function longFlags(text: string): string[] {
  return [...new Set(text.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? [])];
}

const mentions = (text: string, flag: string): boolean => new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(text);

describe('README documents the CLI flags', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'bin', 'playwright-score.js'), '--help'], { encoding: 'utf8' });
  const help = run.stdout;
  const options = helpOptions(help);
  // `diff` has a few options of its own; the README names them in its diff section.
  const known = new Set([...FLAGS.flatMap((f) => f.names), ...DIFF_FLAGS]);

  it('--help prints the options of the flag table', () => {
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual([...options].sort(), FLAGS.flatMap((f) => f.names).sort());
    assert.ok(options.length >= 15, options.join(' '));
  });

  it('every option in --help is in the README', () => {
    const missing = options.filter((o) => !mentions(readme, o));
    assert.deepEqual(missing, []);
  });

  it('every long flag the README names exists', () => {
    const named = longFlags(readme);
    assert.ok(named.length >= 13, named.join(' '));
    assert.deepEqual(named.filter((f) => !known.has(f)), []);
  });

  it('every diff option is in the README', () => {
    assert.deepEqual(DIFF_FLAGS.filter((f) => !mentions(readme, f)), []);
  });

  it('the checks see a missing or an unknown flag', () => {
    assert.equal(mentions('use `--shared-x` here', '--shared'), false);
    assert.equal(mentions('use `--shared` here', '--shared'), true);
    assert.deepEqual(longFlags('`--fail-on none` and --made-up, not a-b--c'), ['--fail-on', '--made-up']);
    assert.deepEqual(helpOptions('x\n\nOptions:\n  --a, -b <n>   help\n                text --c\n  --d   help\n\nExit codes:\n  --e'), ['--a', '-b', '--d']);
  });
});
