import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { cellKey, pathOverrides, tierOverrides } from '../src/catalogue/precision.js';
import { applyGate, gateReasons, gateSettings } from '../src/gate.js';
import type { FailOn, Finding, ScoreOptions, ScoreResult } from '../src/types.js';

// QAG-287 S9c: the gate (pass, threshold, exit code), --fail-on, --allow-partial, --advice and
// `quotable`. Suites come from tests/fixtures/s9a and tests/fixtures/s9c, each in a TypeScript and
// a JavaScript form. The expected verdicts are written out by hand from the fixture code:
//   s9a/weak-only        certain no-weak-assertion (passes-regardless) in a counted test; score 67
//   s9a/hook             certain no-wait-for-selector (flake-risk) in a hook; score 33
//   s9a/describe-level   certain no-wait-for-selector (flake-risk) outside every test; score 100
//   s9a/unasserted       one unasserted test; s9a/unverified: one unverified test (and a flake-risk issue)
//   s9a/partial          one file with a syntax error; the other has a flake-risk issue
//   s9c/hook-weak        certain no-weak-assertion in a hook in scope for two counted tests
//   s9c/outside-weak     certain no-weak-assertion in a describe-local helper, file has counted tests
//   s9c/outside-uncounted  the same helper in a file whose only test is skipped; b.spec is clean
//   s9c/suite            page.pause() in a counted test (suite family; likely in the committed file)
//   s9c/partial-uncounted  a syntax-error file and a file with only a skipped test: no counted test

const execFileAsync = promisify(execFile);

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const cli = path.join(root, 'dist', 'cli.js');
const FORMS = ['ts', 'js'] as const;
const suite = (name: string, form: string): string => {
  const [set, c] = name.split('/');
  return path.join(root, 'tests', 'fixtures', set!, `${c}-${form}`);
};

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  json?: ScoreResult;
}
async function runCli(args: string[]): Promise<CliRun> {
  try {
    const r = await execFileAsync(process.execPath, [cli, ...args], { maxBuffer: 10 * 1024 * 1024 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}
async function cliJson(dir: string, flags: string[]): Promise<CliRun> {
  const r = await runCli([dir, '--format', 'json', ...flags]);
  assert.notEqual(r.code, 2, r.stderr);
  return { ...r, json: JSON.parse(r.stdout) as ScoreResult };
}

const cache = new Map<string, Promise<ScoreResult>>();
const score = (dir: string, extra: Partial<ScoreOptions> = {}): Promise<ScoreResult> => {
  const key = `${dir}\u0000${JSON.stringify(extra)}`;
  if (!cache.has(key)) cache.set(key, scorePaths({ paths: [dir], cwd: dir, ...extra }));
  return cache.get(key)!;
};
const reasonsUnder = async (name: string, form: string, failOn: FailOn[]) => gateReasons(await score(suite(name, form)), gateSettings({ failOn }));

describe('QAG-287 S9c: the CLI gate (child process)', () => {
  // [suite, flags, exit code, gate.reasons]
  const CASES: Array<[string, string[], number, string[]]> = [
    ['s9a/weak-only', [], 1, ['passes-regardless']],
    ['s9a/hook', [], 0, []],
    ['s9c/hook-weak', [], 1, ['passes-regardless']],
    ['s9c/outside-weak', [], 1, ['passes-regardless']],
    ['s9c/outside-uncounted', [], 0, []],
    ['s9a/weak-only', ['--fail-on', 'none', '--threshold', '70'], 1, ['threshold']],
    ['s9a/weak-only', ['--fail-on', 'none', '--threshold', '60'], 0, []],
    ['s9a/weak-only', ['--fail-on', 'passes-regardless'], 1, ['passes-regardless']],
    ['s9a/weak-only', ['--fail-on', 'flake-risk'], 0, []],
    ['s9a/hook', ['--fail-on', 'flake-risk'], 1, ['flake-risk']],
    ['s9a/describe-level', ['--fail-on', 'flake-risk'], 1, ['flake-risk']],
    ['s9a/unasserted', ['--fail-on', 'unasserted'], 1, ['unasserted']],
    ['s9a/unverified', ['--fail-on', 'unasserted'], 1, ['unasserted']],
    ['s9a/weak-only', ['--fail-on', 'unasserted'], 0, []],
    ['s9a/weak-only', ['--fail-on', 'shared'], 0, []],
    ['s9a/weak-only', ['--fail-on', 'none'], 0, []],
    ['s9a/weak-only', ['--fail-on', 'flake-risk,unasserted'], 0, []],
    ['s9a/unverified', ['--fail-on', 'flake-risk,unasserted'], 1, ['flake-risk', 'unasserted']],
    ['s9a/describe-level', ['--fail-on', 'passes-regardless,flake-risk,unasserted'], 1, ['flake-risk']],
    ['s9c/outside-uncounted', ['--fail-on', 'passes-regardless,flake-risk,unasserted'], 0, []],
    ['s9a/partial', [], 1, ['partial']],
    ['s9a/partial', ['--allow-partial'], 0, []],
    ['s9a/partial', ['--fail-on', 'none'], 1, ['partial']],
    ['s9c/partial-uncounted', ['--allow-partial'], 1, ['not-scored']],
    ['s9a/counted-zero', ['--allow-partial', '--fail-on', 'none'], 1, ['not-scored']],
  ];
  for (const [name, flags, code, reasons] of CASES) {
    it(`${name} ${flags.join(' ') || '(default)'} -> exit ${code} ${reasons.join(',') || 'pass'}`, async () => {
      for (const form of FORMS) {
        const r = await cliJson(suite(name, form), flags);
        assert.equal(r.code, code, `${form}: ${r.stderr}`);
        assert.equal(r.json!.pass, code === 0, form);
        assert.deepEqual(r.json!.gate!.reasons, reasons, form);
        const t = flags.indexOf('--threshold');
        assert.equal(r.json!.threshold, t >= 0 ? Number(flags[t + 1]) : 0, form);
        assert.equal(r.json!.gate!.thresholdApplied, t >= 0, form);
        assert.equal(r.json!.gate!.allowPartial, flags.includes('--allow-partial'), form);
      }
    });
  }

  it('the default gate passes a suite at score 33 and the JSON says why nothing failed', async () => {
    const r = await cliJson(suite('s9a/hook', 'ts'), []);
    assert.equal(r.json!.score, 33);
    assert.deepEqual(r.json!.gate, { failOn: ['passes-regardless'], allowPartial: false, thresholdApplied: false, reasons: [] });
  });

  it('usage errors exit 2 with no output: none combined, an unknown value, an empty item, a missing value', async () => {
    const dir = suite('s9a/weak-only', 'ts');
    for (const flags of [['--fail-on', 'none,flake-risk'], ['--fail-on', 'flake-risk', '--fail-on', 'none'], ['--fail-on', 'bogus'], ['--fail-on', 'flake-risk,'], ['--fail-on'], ['--threshold', '101']]) {
      const r = await runCli([dir, '--format', 'json', ...flags]);
      assert.equal(r.code, 2, flags.join(' '));
      assert.equal(r.stdout, '', flags.join(' '));
      assert.ok(r.stderr.length > 0, flags.join(' '));
    }
  });

  it('--help lists every option, every --fail-on value and the three exit codes', async () => {
    const r = await runCli(['--help']);
    assert.equal(r.code, 0);
    for (const s of ['--fail-on <list>', '--threshold <n>', '--allow-partial', '--advice', '--format', '--out, --output', '--name', '--max-seconds', '--max-heap-mb', '--profile', '--version', '--help']) {
      assert.ok(r.stdout.includes(s), s);
    }
    for (const v of ['passes-regardless', 'flake-risk', 'unasserted', 'shared', 'none']) assert.ok(r.stdout.includes(`  ${v}  `), v);
    assert.match(r.stdout, /suite finding \(page\.pause\(\)/);
    for (const c of ['  0  pass', '  1  not pass', '  2  tool or usage error']) assert.ok(r.stdout.includes(c), c);
  });

  it('--advice is accepted and changes no output', async () => {
    const dir = suite('s9a/weak-only', 'js');
    for (const format of ['text', 'json']) {
      const a = await runCli([dir, '--format', format]);
      const b = await runCli([dir, '--format', format, '--advice']);
      assert.equal(b.code, a.code);
      assert.equal(b.stdout, a.stdout, format);
    }
  });
});

describe('QAG-287 S9c: the library gate (scorePaths)', () => {
  it('defaults: failOn passes-regardless, no threshold (0), allowPartial false', async () => {
    for (const form of FORMS) {
      const r = await score(suite('s9a/weak-only', form));
      assert.equal(r.score, 67);
      assert.equal(r.pass, false);
      assert.equal(r.threshold, 0);
      assert.deepEqual(r.gate, { failOn: ['passes-regardless'], allowPartial: false, thresholdApplied: false, reasons: ['passes-regardless'] });
      const hook = await score(suite('s9a/hook', form));
      assert.equal(hook.pass, true);
    }
  });

  it('options reach the gate: failOn, threshold, allowPartial', async () => {
    for (const form of FORMS) {
      assert.equal((await score(suite('s9a/weak-only', form), { failOn: ['flake-risk'] })).pass, true);
      assert.equal((await score(suite('s9a/hook', form), { failOn: ['flake-risk'] })).pass, false);
      const t = await score(suite('s9a/weak-only', form), { failOn: ['none'], threshold: 70 });
      assert.deepEqual([t.pass, t.threshold, t.gate!.reasons], [false, 70, ['threshold']]);
      assert.equal((await score(suite('s9a/partial', form), { allowPartial: true })).pass, true);
      const nz = await score(suite('s9c/partial-uncounted', form), { allowPartial: true });
      assert.deepEqual([nz.status, nz.pass], ['not-scored', false]);
    }
  });

  it('every failOn value and two combinations, read from the same results', async () => {
    const want: Array<[string, FailOn[], string[]]> = [
      ['s9c/hook-weak', ['passes-regardless'], ['passes-regardless']],
      ['s9c/hook-weak', ['flake-risk'], []],
      ['s9c/outside-weak', ['passes-regardless'], ['passes-regardless']],
      ['s9c/outside-uncounted', ['passes-regardless'], []],
      ['s9a/conditional-skip', ['flake-risk'], ['flake-risk']],
      ['s9a/unasserted', ['unasserted'], ['unasserted']],
      ['s9a/unasserted', ['passes-regardless', 'flake-risk'], []],
      ['s9a/unverified', ['unasserted', 'flake-risk'], ['flake-risk', 'unasserted']],
      ['s9a/weak-only', ['shared'], []],
      ['s9a/weak-only', ['none'], []],
    ];
    for (const form of FORMS) {
      for (const [name, failOn, reasons] of want) assert.deepEqual(await reasonsUnder(name, form, failOn), reasons, `${name} ${form} ${failOn}`);
    }
  });

  it('flake-risk also names the suite family (page.pause() made certain through the test seam)', async () => {
    const key = cellKey('playwright/no-page-pause', '-', 'spec');
    for (const form of FORMS) {
      assert.deepEqual(await reasonsUnder('s9c/suite', form, ['flake-risk']), [], 'likely in the committed file: never gates');
      tierOverrides.set(key, 'certain');
      try {
        const r = await scorePaths({ paths: [suite('s9c/suite', form)], cwd: root, failOn: ['flake-risk'] });
        assert.deepEqual(r.gate!.reasons, ['flake-risk'], form);
        assert.equal((await scorePaths({ paths: [suite('s9c/suite', form)], cwd: root })).pass, true, `${form}: default ignores the suite family`);
      } finally {
        tierOverrides.delete(key);
      }
    }
  });

  it('unusable options throw a RangeError before any file is read', async () => {
    for (const failOn of [['none', 'flake-risk'], ['bogus'], []] as unknown as FailOn[][]) {
      await assert.rejects(scorePaths({ paths: ['/nonexistent'], failOn }), RangeError, JSON.stringify(failOn));
    }
  });
});

describe('QAG-287 S9c: shared findings (synthetic result)', () => {
  const base = (findings: Partial<Finding>[]): ScoreResult => ({
    scoreVersion: 'v5', profile: 'standard', score: 100, grade: 'A', pass: true, threshold: 0, status: 'scored',
    summary: { files: 2, tests: 2, sloc: 10, findings: 0, errors: 0, warnings: 0, nativeLocators: 0, rawLocators: 0, unassertedTests: 0, unverifiedTests: 0, cleanTests: 2 },
    dimensions: { playwrightHygiene: 100, assertions: 100, locators: 100, structure: 100 },
    testStates: [
      { file: 'a.spec.ts', testKey: 'a.spec.ts#0', line: 3, state: 'clean' },
      { file: 'b.spec.ts', testKey: 'b.spec.ts#0', line: 3, state: 'excluded-skipped' },
    ],
    outsideTests: [],
    findings: findings.map((f) => ({ rule: 'pwscore/no-weak-assertion', severity: 'warning', message: 'm', file: 'pages/cart.ts', line: 4, column: 3, dimension: 'assertions', scope: 'shared', form: '-', family: 'passes-regardless', ...f }) as Finding),
  });
  const run = (r: ScoreResult, failOn: FailOn[]) => applyGate(r, gateSettings({ failOn })).gate!.reasons;

  it('a certain shared finding used by a spec with a counted test fails `shared` only', () => {
    const r = () => base([{ tier: 'certain', usedBy: ['a.spec.ts', 'b.spec.ts'] }]);
    assert.deepEqual(run(r(), ['shared']), ['shared']);
    assert.deepEqual(run(r(), ['passes-regardless', 'flake-risk']), [], 'family values never read a shared finding');
    assert.deepEqual(run(r(), ['passes-regardless', 'shared']), ['shared']);
  });
  it('a likely shared finding never gates; nor does a certain one used only by a spec with no counted test', () => {
    assert.deepEqual(run(base([{ tier: 'likely', usedBy: ['a.spec.ts'] }]), ['shared']), []);
    assert.deepEqual(run(base([{ tier: 'certain', usedBy: ['b.spec.ts'] }]), ['shared']), []);
    assert.deepEqual(run(base([{ tier: 'certain' }]), ['shared']), []);
  });
});

describe('QAG-287 S9c: quotable', () => {
  it('is a boolean on every finding, and false everywhere with the committed precision file (no cell has path M)', async () => {
    for (const name of ['s9a/weak-only', 's9a/hook', 's9c/hook-weak', 's9c/outside-weak', 's9c/suite', 's9a/partial']) {
      for (const form of FORMS) {
        const r = await score(suite(name, form));
        assert.ok(r.findings.length > 0, name);
        for (const f of r.findings) assert.equal(f.quotable, false, `${name} ${form} ${f.rule}`);
      }
    }
  });

  it('true only for a certain finding whose cell has path M; BC, likely, advisory and needs-check never', async () => {
    for (const form of FORMS) {
      const dir = suite('s9a/weak-only', form);
      const first = await scorePaths({ paths: [dir], cwd: dir });
      const cells = [...new Set(first.findings.map((f) => cellKey(f.rule, f.form ?? '-', 'spec')))];
      assert.ok(first.findings.some((f) => f.tier === 'certain') && first.findings.some((f) => f.tier !== 'certain'), 'both kinds present');
      for (const p of ['M', 'BC'] as const) {
        for (const c of cells) pathOverrides.set(c, p);
        try {
          const r = await scorePaths({ paths: [dir], cwd: dir });
          for (const f of r.findings) assert.equal(f.quotable, p === 'M' && f.tier === 'certain', `${form} ${p} ${f.rule} ${f.tier}`);
          assert.ok(r.findings.some((f) => f.quotable) === (p === 'M'));
        } finally {
          pathOverrides.clear();
        }
      }
    }
  });
});
