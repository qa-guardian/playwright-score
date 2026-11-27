import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { indexTests } from '../src/diff/test-index.js';
import { compareSides } from '../src/diff/compare.js';
import { compareSignals, MATCHER_STRENGTH } from '../src/diff/weakening.js';
import { parseDiffArgs } from '../src/diff/run.js';
import type { SideData, SideFinding, SideTest } from '../src/diff/side.js';

// `playwright-score diff` (QAG-289 S1 + S2 start). The fixtures are before/after pairs under
// tests/fixtures/diff/<change>/{base,head}; each pair shows one kind of change.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const root = packageRoot();
const cli = path.join(root, 'dist', 'cli.js');
const fx = (name: string, side: 'base' | 'head'): string => path.join(root, 'tests', 'fixtures', 'diff', name, side);

interface Run {
  status: number | null;
  out: string;
  err: string;
  json: any;
}
function diff(args: string[], cwd?: string): Run {
  const r = spawnSync(process.execPath, [cli, 'diff', ...args], { encoding: 'utf8', cwd });
  let json: any;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = undefined;
  }
  return { status: r.status, out: r.stdout, err: r.stderr, json };
}
const pair = (name: string, extra: string[] = []): Run => diff([fx(name, 'base'), fx(name, 'head'), '--json', ...extra]);

describe('diff: findings and scores', () => {
  it('a certain finding added to one test is new, and its file loses score', () => {
    const r = pair('new-finding');
    assert.equal(r.status, 1, r.err);
    assert.equal(r.json.diffVersion, 1);
    assert.equal(r.json.newFindings.length, 1);
    const f = r.json.newFindings[0];
    assert.equal(f.file, 'cart.spec.ts');
    assert.equal(f.where, 'cart > removes an item');
    assert.deepEqual(f.testPath, ['cart', 'removes an item']);
    assert.equal(r.json.gate.pass, false);
    assert.deepEqual(r.json.gate.reasons, ['new-certain-findings']);
    assert.ok(r.json.scoreBefore > r.json.scoreAfter, `${r.json.scoreBefore} -> ${r.json.scoreAfter}`);
    assert.equal(r.json.scoreDrop, r.json.scoreBefore - r.json.scoreAfter);
    // Only the changed file is listed; login.spec.ts is the same on both sides.
    assert.deepEqual(r.json.files.map((x: any) => x.file), ['cart.spec.ts']);
    assert.equal(r.json.files[0].before, 100);
    assert.equal(r.json.files[0].after, 50);
    assert.equal(r.json.files[0].drop, 50);
  });

  it('the text output names the finding and says FAIL', () => {
    const r = diff([fx('new-finding', 'base'), fx('new-finding', 'head')]);
    assert.equal(r.status, 1, r.err);
    assert.match(r.out, /New certain findings: 1/);
    assert.match(r.out, /cart > removes an item/);
    assert.match(r.out, /FAIL: the head introduces certain findings/);
  });

  it('the same finding on a different line is not new (keyed by rule, file and test title path)', () => {
    const r = pair('line-shift');
    assert.equal(r.status, 0, r.err);
    assert.equal(r.json.newFindings.length, 0);
    assert.equal(r.json.resolvedFindings.length, 0);
    assert.deepEqual(r.json.files, []);
    assert.equal(r.json.scoreDrop, 0);
  });

  it('swapping the sides makes the finding resolved, and passes', () => {
    const r = diff([fx('new-finding', 'head'), fx('new-finding', 'base'), '--json']);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.json.newFindings.length, 0);
    assert.equal(r.json.resolvedFindings.length, 1);
    assert.ok(r.json.scoreDrop < 0);
  });

  it('identical sides pass with no change', () => {
    const r = pair('unchanged');
    assert.equal(r.status, 0, r.err);
    assert.equal(r.json.scoreBefore, 100);
    assert.equal(r.json.scoreAfter, 100);
    assert.equal(r.json.scoreDrop, 0);
    assert.deepEqual(r.json.testChanges, { deleted: [], addedSkip: [], assertionsDropped: [], weakerMatcher: [], changedExpectedLiteral: [], raisedTimeout: [] });
  });

  it('--max-drop adds a score bar on top of the new-finding gate', () => {
    const r = pair('new-finding', ['--max-drop', '10']);
    assert.deepEqual(r.json.gate.reasons, ['new-certain-findings', 'score-drop']);
    assert.equal(r.json.gate.maxDrop, 10);
    const ok = pair('new-finding', ['--max-drop', '60']);
    assert.deepEqual(ok.json.gate.reasons, ['new-certain-findings']);
  });

  it('--out writes the report to a file instead of stdout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-diff-out-'));
    try {
      const out = path.join(dir, 'sub', 'diff.json');
      const r = diff([fx('unchanged', 'base'), fx('unchanged', 'head'), '--json', '--out', out]);
      assert.equal(r.status, 0, r.err);
      assert.equal(r.out, '');
      assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).diffVersion, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('diff: tests matched by title path (S2)', () => {
  it('a deleted test is reported, and fails only with --fail-on-changes', () => {
    const r = pair('deleted-test');
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.json.testChanges.deleted, [{ file: 'search.spec.ts', test: ['search', 'shows no results'] }]);
    assert.equal(r.json.newFindings.length, 0);
    const strict = pair('deleted-test', ['--fail-on-changes']);
    assert.equal(strict.status, 1);
    assert.deepEqual(strict.json.gate.reasons, ['test-changes']);
  });

  it('skip, fixme and a skipped describe added to counted tests are reported', () => {
    const r = pair('added-skip');
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(
      r.json.testChanges.addedSkip.map((t: any) => t.test.join(' > ')),
      ['avatar > uploads a picture', 'edits the name', 'shows the name']
    );
    assert.deepEqual(r.json.testChanges.deleted, []);
    assert.equal(pair('added-skip', ['--fail-on-changes']).status, 1);
  });

  it('a test with fewer expect() calls is reported with both counts', () => {
    const r = pair('assertions-dropped');
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(r.json.testChanges.assertionsDropped, [
      { file: 'checkout.spec.ts', test: ['pays for the order'], before: 3, after: 1 },
    ]);
    assert.equal(pair('assertions-dropped', ['--fail-on-changes']).status, 1);
  });
});

describe('diff: weakened tests (S2b)', () => {
  it('weakerMatcher: toHaveText, toEqual, toHaveCount and toBe swapped for weaker ones; stronger, reordered and renamed are not', () => {
    const r = pair('weaker-matcher');
    assert.equal(r.status, 0, r.err);
    const w = r.json.testChanges.weakerMatcher.map((x: any) => `${x.test.join(' > ')}: ${x.before} -> ${x.after}`);
    assert.deepEqual(w, [
      'lists three orders: toHaveCount -> toBeGreaterThan',
      'reads the plan: toBe -> toBeDefined',
      'reads the user record: toEqual -> toBeTruthy',
      'shows the saved banner: toHaveText -> toBeVisible',
    ]);
    assert.equal(r.json.testChanges.weakerMatcher[0].subject, 'rows');
    // The renamed test is a deletion, nothing else.
    assert.deepEqual(r.json.testChanges.deleted.map((x: any) => x.test[0]), ['old name']);
    assert.deepEqual(r.json.testChanges.changedExpectedLiteral, []);
    assert.deepEqual(r.json.testChanges.raisedTimeout, []);
  });

  it('weakerMatcher: a moved subject, a regex or object argument, true read as truthy and a single count read as visible are not weakening', () => {
    const r = pair('weaker-matcher-moved', ['--fail-on-changes']);
    assert.deepEqual(r.json.testChanges.weakerMatcher.map((x: any) => `${x.test.join(' > ')}: ${x.before} -> ${x.after}`), [
      'genuine weakening on the same subject: toHaveText -> toBeVisible',
    ]);
    assert.equal(r.status, 1);
  });

  it('weakerMatcher fails --fail-on-changes and is named in the text output', () => {
    const strict = pair('weaker-matcher', ['--fail-on-changes']);
    assert.equal(strict.status, 1);
    assert.deepEqual(strict.json.gate.reasons, ['test-changes']);
    assert.equal(pair('weaker-matcher').json.gate.pass, true);
    const t = diff([fx('weaker-matcher', 'base'), fx('weaker-matcher', 'head')]);
    assert.match(t.out, /4 with a weaker matcher/);
    assert.match(t.out, /weaker matcher toHaveText -> toBeVisible on page\.getByTestId\('banner'\): orders\.spec\.ts > shows the saved banner/);
  });

  it('changedExpectedLiteral: a changed string is reported for review and never gates', () => {
    const r = pair('changed-literal', ['--fail-on-changes']);
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(
      r.json.testChanges.changedExpectedLiteral.map((x: any) => [x.test[0], x.matcher, x.before, x.after]),
      [
        ['confirms the save', 'toHaveText', 'Saved', 'Save'],
        ['links to the invoice', 'toHaveAttribute', '/invoices/1', '/invoices/2'],
      ]
    );
    assert.deepEqual(r.json.testChanges.weakerMatcher, []);
    assert.deepEqual(r.json.gate.reasons, []);
    const t = diff([fx('changed-literal', 'base'), fx('changed-literal', 'head')]);
    assert.match(t.out, /Expected values changed \(review, not a gate\): 2/);
    assert.match(t.out, /toHaveText on page\.getByTestId\('status'\): 'Saved' -> 'Save'/);
  });

  it('raisedTimeout: setTimeout, an expect timeout and a waitFor timeout raised 2x or more; lowered, under 2x and newly added are not', () => {
    const r = pair('raised-timeout');
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(
      r.json.testChanges.raisedTimeout.map((x: any) => [x.test[0], x.kind, x.before, x.after]),
      [
        ['assertion timeout', 'expect', 5000, 15000],
        ['waitFor timeout', 'waitFor', 5000, 10000],
        ['whole-test timeout', 'setTimeout', 30000, 90000],
      ]
    );
    const strict = pair('raised-timeout', ['--fail-on-changes']);
    assert.equal(strict.status, 1);
    assert.deepEqual(strict.json.gate.reasons, ['test-changes']);
    assert.match(diff([fx('raised-timeout', 'base'), fx('raised-timeout', 'head')]).out, /timeout 30000 -> 90000 ms \(test\.setTimeout\): slow\.spec\.ts > whole-test timeout/);
  });

  it('swapping the sides reports only what became weaker or raised (lowered timeouts and the changed literal are not)', () => {
    for (const name of ['weaker-matcher', 'raised-timeout']) {
      const r = diff([fx(name, 'head'), fx(name, 'base'), '--json']);
      // Swapped, the stronger 'shows the title' of the base is the weaker one: the one expected hit.
      assert.equal(r.json.testChanges.weakerMatcher.length, name === 'weaker-matcher' ? 1 : 0, name);
      assert.deepEqual(r.json.testChanges.raisedTimeout.length, name === 'raised-timeout' ? 2 : 0, name);
    }
  });

  it('the strength table has four levels and lists every matcher once', () => {
    assert.deepEqual([...new Set(Object.values(MATCHER_STRENGTH))].sort(), [1, 2, 3, 4]);
    assert.ok(MATCHER_STRENGTH.toHaveText! > MATCHER_STRENGTH.toContainText!);
    assert.ok(MATCHER_STRENGTH.toContainText! > MATCHER_STRENGTH.toBeGreaterThan!);
    assert.ok(MATCHER_STRENGTH.toBeGreaterThan! > MATCHER_STRENGTH.toBeVisible!);
  });
});

describe('diff: weakening signals, pure (S2b)', () => {
  const facts = (body: string) => {
    const src = `test('t', async () => {\n${body}\n});`;
    const t = indexTests(src, 'a.spec.ts', new Set([1])).get(1)!;
    return { assertions: t.assertions, timeouts: t.timeouts };
  };
  const sig = (a: string, b: string) => compareSignals(facts(a), facts(b));

  it('does not flag negated assertions, an unlisted matcher or a subject that differs', () => {
    assert.deepEqual(sig('await expect(a).not.toHaveText("x");', 'await expect(a).not.toBeVisible();').weakerMatcher, []);
    assert.deepEqual(sig('await expect(a).toBeChecked();', 'await expect(a).toBeVisible();').weakerMatcher, []);
    assert.deepEqual(sig('await expect(a).toHaveText("x");', 'await expect(b).toBeVisible();').weakerMatcher, []);
  });

  it('the five reviewed false positives are not flagged; a plain literal on the same subject still is', () => {
    const w = (a: string, b: string) => sig(a, b).weakerMatcher;
    assert.deepEqual(w('await expect(row).toHaveText("x");', 'await expect(row).toBeVisible(); await expect(row.getByRole("cell")).toHaveText("x");'), []);
    assert.deepEqual(w('await expect(a).toHaveText(/Welcome/);', 'await expect(a).toContainText("Welcome back");'), []);
    assert.deepEqual(w('expect(u).toEqual(expect.objectContaining({ a: 1 }));', 'expect(u).toMatchObject({ a: 1 });'), []);
    assert.deepEqual(w('expect(await x.isEnabled()).toBe(true);', 'expect(await x.isEnabled()).toBeTruthy();'), []);
    assert.deepEqual(w('await expect(a).toHaveCount(1);', 'await expect(a).toBeVisible();'), []);
    assert.equal(w('await expect(a).toHaveText("Order #123");', 'await expect(a).toBeVisible();').length, 1);
    assert.equal(w('expect(n).toBe(null);', 'expect(n).toBeDefined();').length, 1);
    assert.equal(w('expect(n).toBe(false);', 'expect(n).toBeTruthy();').length, 1);
    assert.equal(w('await expect(a).toHaveCount(3);', 'expect(await a.count()).toBeGreaterThan(0);').length, 1);
  });

  it('does not guess when more than one assertion on a subject changed', () => {
    const s = sig('await expect(a).toHaveText("x"); await expect(a).toHaveValue("y");', 'await expect(a).toBeVisible(); await expect(a).toBeAttached();');
    assert.deepEqual(s.weakerMatcher, []);
  });

  it('same level is not weaker; a changed literal alongside a changed option is not reported', () => {
    assert.deepEqual(sig('await expect(a).toBeVisible();', 'await expect(a).toBeAttached();').weakerMatcher, []);
    assert.deepEqual(sig('await expect(a).toHaveText("x");', 'await expect(a).toHaveText("y", { timeout: 1 });').changedExpectedLiteral, []);
    assert.deepEqual(sig('await expect(a).toHaveText("x");', 'await expect(a).toHaveText(y);').changedExpectedLiteral, []);
  });

  it('reads 5 * 1000 and ignores a non-numeric timeout and waitForTimeout', () => {
    assert.equal(facts('test.setTimeout(5 * 1000);').timeouts[0]?.ms, 5000);
    assert.equal(facts('test.setTimeout(limit);').timeouts.length, 0);
    assert.equal(facts('await page.waitForTimeout(500);').timeouts.length, 0);
  });

  it('a timeout is paired only when both sides have the same count of it', () => {
    assert.deepEqual(sig('test.setTimeout(1000);', 'test.setTimeout(9000); test.setTimeout(9000);').raisedTimeout, []);
    assert.equal(sig('test.setTimeout(1000);', 'test.setTimeout(2000);').raisedTimeout.length, 1);
    assert.equal(sig('test.setTimeout(1000);', 'test.setTimeout(1999);').raisedTimeout.length, 0);
  });
});

describe('diff: git refs', () => {
  it('exports a ref with git archive and leaves the working tree alone', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-diff-git-'));
    const git = (...a: string[]): string => {
      const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], { cwd: repo, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-q');
      git('checkout', '-q', '-b', 'trunk');
      fs.mkdirSync(path.join(repo, 'e2e'));
      fs.copyFileSync(path.join(fx('new-finding', 'base'), 'cart.spec.ts'), path.join(repo, 'e2e', 'cart.spec.ts'));
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      git('tag', 'v1');
      fs.copyFileSync(path.join(fx('new-finding', 'head'), 'cart.spec.ts'), path.join(repo, 'e2e', 'cart.spec.ts'));
      git('commit', '-q', '-am', 'head');
      // An uncommitted edit the diff must neither read nor disturb.
      fs.writeFileSync(path.join(repo, 'e2e', 'scratch.txt'), 'work in progress\n');
      const before = git('status', '--porcelain');

      const r = diff(['v1', 'HEAD', '--json'], repo);
      assert.equal(r.status, 1, r.err);
      assert.equal(r.json.base.kind, 'git-ref');
      assert.equal(r.json.base.label, 'v1');
      assert.equal(r.json.newFindings.length, 1);
      assert.equal(r.json.newFindings[0].file, 'e2e/cart.spec.ts');
      assert.equal(git('status', '--porcelain'), before);
      assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'trunk');
      // A directory and a ref can be mixed; --path narrows both.
      const mixed = diff(['v1', path.join(repo, 'e2e'), '--json'], repo);
      assert.equal(mixed.status, 1, mixed.err);
      const narrowed = diff(['v1', 'HEAD', '--path', 'e2e', '--json'], repo);
      assert.equal(narrowed.json.newFindings.length, 1);
      // Run from a sub folder, a ref is scored from that folder.
      const sub = diff(['v1', 'HEAD', '--json'], path.join(repo, 'e2e'));
      assert.equal(sub.json.newFindings[0].file, 'cart.spec.ts');
      // No temporary export is left behind.
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('pwscore-diff-') && fs.existsSync(path.join(os.tmpdir(), n, 'tree', 'e2e', 'cart.spec.ts'))), []);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('an unknown ref is a usage error (exit 2), not a pass', () => {
    const r = diff([fx('unchanged', 'base'), 'no-such-ref-anywhere'], fx('unchanged', 'base'));
    assert.equal(r.status, 2);
    assert.match(r.err, /not a directory, and not a git ref/);
  });
});

describe('diff: usage', () => {
  const bad = (args: string[], message: RegExp): void => {
    const r = diff(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, message);
  };
  it('needs exactly two sides', () => bad([fx('unchanged', 'base')], /exactly two arguments/));
  it('refuses scoring-gate options that do not apply', () => {
    bad([fx('unchanged', 'base'), fx('unchanged', 'head'), '--threshold', '80'], /--threshold does not apply/);
    bad([fx('unchanged', 'base'), fx('unchanged', 'head'), '--fail-on', 'none'], /--fail-on does not apply/);
  });
  it('checks --max-drop and --format', () => {
    bad([fx('unchanged', 'base'), fx('unchanged', 'head'), '--max-drop', 'x'], /--max-drop must be a number/);
    bad([fx('unchanged', 'base'), fx('unchanged', 'head'), '--max-drop', '101'], /--max-drop must be a number/);
    bad([fx('unchanged', 'base'), fx('unchanged', 'head'), '--format', 'sarif'], /not available for diff/);
    bad([fx('unchanged', 'base'), fx('unchanged', 'head'), '--nope'], /Unknown option/);
  });
  it('--help prints the diff usage and exits 0', () => {
    const r = diff(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.out, /pwscore diff <base> <head>/);
    assert.doesNotMatch(r.out, /--threshold/);
  });
  it('parses the shared scoring options', () => {
    const a = parseDiffArgs(['a', 'b', '--max-seconds', '30', '--json', '--no-shared', '--max-drop', '5']);
    assert.ok(!('error' in a));
    if ('error' in a) return;
    assert.equal(a.scoring.maxSeconds, 30);
    assert.equal(a.scoring.shared, false);
    assert.equal(a.json, true);
    assert.equal(a.maxDrop, 5);
  });
});

describe('diff: comparison rules', () => {
  const side = (over: Partial<SideData> = {}): SideData => ({
    status: 'scored',
    score: 100,
    grade: 'A',
    countedTests: 1,
    chargedTests: 0,
    files: new Map(),
    tests: new Map(),
    findings: [],
    ...over,
  });
  const finding = (rule: string, where = 'a'): SideFinding => ({ rule, file: 'x.spec.ts', where, message: rule });
  const none = { maxDrop: undefined, failOnChanges: false, allowPartial: false };

  it('a score drop alone fails only past --max-drop, and without one nothing but findings gate', () => {
    const a = side({ score: 90 });
    const b = side({ score: 70 });
    assert.equal(compareSides(a, b, none).pass, true);
    assert.deepEqual(compareSides(a, b, { ...none, maxDrop: 10 }).reasons, ['score-drop']);
    assert.equal(compareSides(a, b, { ...none, maxDrop: 20 }).pass, true);
  });

  it('counts a repeated finding of one rule in one test once per extra occurrence', () => {
    const d = compareSides(side({ findings: [finding('r')] }), side({ findings: [finding('r'), finding('r'), finding('s')] }), none);
    assert.deepEqual(d.newFindings.map((f) => [f.rule, f.extra]), [['r', 1], ['s', 1]]);
  });

  it('a head with no counted test, or a partial head, fails; a not-scored base does not', () => {
    assert.deepEqual(compareSides(side(), side({ status: 'not-scored', score: 0 }), none).reasons, ['head-not-scored']);
    assert.deepEqual(compareSides(side(), side({ status: 'partial' }), none).reasons, ['head-partial']);
    assert.equal(compareSides(side(), side({ status: 'partial' }), { ...none, allowPartial: true }).pass, true);
    const d = compareSides(side({ status: 'not-scored', score: 0 }), side({ score: 60 }), none);
    assert.equal(d.pass, true);
    assert.equal(d.scoreBefore, null);
    assert.equal(d.scoreDrop, null);
  });

  it('a skipped or empty test on the base side is not reported as deleted or newly skipped', () => {
    const t = (state: SideTest['state'], counted: boolean): SideTest => ({ file: 'x.spec.ts', titlePath: ['t'], state, counted });
    const base = side({ tests: new Map([['x.spec.ts\u0000t', t('excluded-skipped', false)]]) });
    assert.deepEqual(compareSides(base, side(), none).testChanges.deleted, []);
  });
});

describe('diff: test index', () => {
  const src = [
    "import { test, expect } from '@playwright/test';",
    "test.describe('outer', () => {",
    "  test.describe('inner', () => {",
    "    test('one', async ({ page }) => {",
    '      await expect(page).toHaveURL(/a/);',
    '      await expect.soft(page.locator("b")).toBeVisible();',
    '      await expect.poll(() => 1).toBe(1);',
    '    });',
    '  });',
    '  for (const n of [1, 2]) {',
    '    test(`case ${n}`, async () => {});',
    '  }',
    "  test('dup', async () => {});",
    "  test('dup', async () => { await expect(1).toBe(1); });",
    '});',
  ].join('\n');

  it('gives the title path, the assertion count and a suffix for a repeated title', () => {
    const m = indexTests(src, 'x.spec.ts', new Set([4, 11, 13, 14]));
    assert.deepEqual({ ...m.get(4), assertions: undefined, timeouts: undefined }, { titlePath: ['outer', 'inner', 'one'], line: 4, expects: 3, assertions: undefined, timeouts: undefined });
    assert.deepEqual(m.get(4)?.assertions.map((a) => a.matcher), ['toHaveURL', 'toBeVisible', 'toBe']);
    assert.deepEqual(m.get(11)?.titlePath, ['outer', 'case ${}']);
    assert.deepEqual(m.get(13)?.titlePath, ['outer', 'dup']);
    assert.deepEqual(m.get(14)?.titlePath, ['outer', 'dup [2]']);
    assert.equal(m.get(14)?.expects, 1);
  });

  it('gives nothing for a file that does not parse', () => {
    assert.equal(indexTests('test((', 'bad.spec.ts', new Set([1])).size, 0);
  });
});
