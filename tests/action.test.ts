import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FLAGS } from '../src/cli-args.js';

// The GitHub Action 3.x (action.yml) and the CLI flag it needs: one scorer run writes the JSON report
// (--format json --out) and the markdown report (--markdown-out).

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const root = packageRoot();
const yml = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');

/** The block of one input: its lines up to the next input. */
function input(name: string): string {
  const m = new RegExp(`^  ${name}:\\n((?:    .*\\n)+)`, 'm').exec(yml);
  assert.ok(m, `input ${name}`);
  return m[1]!;
}
const defaultOf = (name: string): string | undefined => /^ {4}default: (.*)$/m.exec(input(name))?.[1];

describe('action.yml (3.x)', () => {
  it('runs major version 3 by default', () => assert.equal(defaultOf('version'), "'3'"));

  it('an empty threshold means no score bar, and the description says so', () => {
    assert.equal(defaultOf('threshold'), "''");
    assert.match(input('threshold'), /no score bar/);
    assert.match(yml, /if \[ -n "\$PWS_THRESHOLD" \]; then\n\s+GATE_ARGS\+=\(--threshold "\$PWS_THRESHOLD"\)/);
  });

  it('has the allow-partial and max-seconds inputs and passes them to the CLI', () => {
    assert.equal(defaultOf('allow-partial'), "'false'");
    assert.equal(defaultOf('max-seconds'), "''");
    assert.match(yml, /PWS_ALLOW_PARTIAL: \$\{\{ inputs\.allow-partial \}\}/);
    assert.match(yml, /PWS_MAX_SECONDS: \$\{\{ inputs\.max-seconds \}\}/);
    assert.match(yml, /GATE_ARGS\+=\(--allow-partial\)/);
    assert.match(yml, /GATE_ARGS\+=\(--max-seconds "\$PWS_MAX_SECONDS"\)/);
  });

  it('runs the scorer once, writing JSON and markdown, with known flags only', () => {
    const runs = yml.match(/npx --yes -p /g) ?? [];
    assert.equal(runs.length, 1);
    const call = /npx --yes -p [^\n]*playwright-score \\\n((?:.*\\\n)*.*)\n/.exec(yml);
    assert.ok(call);
    assert.match(call[1]!, /--format json --out "\$RUNNER_TEMP\/pw-score\.json"/);
    assert.match(call[1]!, /--markdown-out "\$RUNNER_TEMP\/pw-score\.md"/);
    const known = new Set(FLAGS.flatMap((f) => f.names));
    const scorerArgs = [call[1]!, ...(yml.match(/GATE_ARGS\+=\(.*\)/g) ?? [])].join('\n');
    const used = scorerArgs.match(/(?<=[\s(])--[a-z][a-z-]*/g) ?? [];
    assert.ok(used.length >= 7, used.join(' '));
    for (const flag of used) assert.ok(known.has(flag), flag);
  });

  it('describes the default gate, not only a score below a threshold', () => {
    assert.doesNotMatch(yml, /score is below the threshold, or/);
    assert.doesNotMatch(yml, /when the score is below threshold/);
    assert.match(input('mode'), /does not pass/);
    assert.match(yml, /did not pass: a test would pass whatever the app does/);
  });
});

describe('--markdown-out', () => {
  let dir = '';
  const cli = (args: string[]): number | null =>
    spawnSync(process.execPath, [path.join(root, 'bin', 'playwright-score.js'), ...args], { cwd: dir, encoding: 'utf8' }).status;
  const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf8');
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pws-md-out-'));
    fs.mkdirSync(path.join(dir, 'specs'));
    fs.writeFileSync(
      path.join(dir, 'specs', 'home.spec.ts'),
      `import { test, expect } from '@playwright/test';\n\ntest('waits', async ({ page }) => {\n  await page.goto('/');\n  await page.waitForTimeout(500);\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`,
    );
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('one run writes the same JSON and markdown as two separate runs', () => {
    const both = cli(['specs', '--format', 'json', '--out', 'one.json', '--markdown-out', 'out/one.md']);
    assert.equal(cli(['specs', '--format', 'json', '--out', 'two.json']), both);
    assert.equal(cli(['specs', '--format', 'markdown', '--out', 'two.md']), both);
    assert.equal(read('one.json'), read('two.json'));
    assert.equal(read('out/one.md'), read('two.md'));
    assert.match(read('out/one.md'), /\S/);
  });

  it('needs a value', () => assert.equal(cli(['specs', '--markdown-out']), 2));
});
