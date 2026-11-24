import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { scorePaths, getTestSpans } from '../src/index.js';
import { cellKey, tierOverrides } from '../src/catalogue/precision.js';
import { applyStateScore } from '../src/state-score.js';
import { settleTestStates, stageTestStates, UNASSERTED_RULE } from '../src/test-states.js';
import type { Finding, FindingRef, ScoreResult } from '../src/types.js';

// QAG-287 S9a: score model v5, the share of counted tests that are clean, read from the test
// states. Every suite under tests/fixtures/s9a has a TypeScript and a JavaScript form
// (<case>-ts, <case>-js) with the same tests; the expected states and numbers below are written
// out by hand from the fixture code, never derived from the code under test.

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
const fixtures = path.join(root, 'tests', 'fixtures', 's9a');
const UNASSERTED_CELL = cellKey(UNASSERTED_RULE, '-', 'spec');
const WAIT = 'playwright/no-wait-for-selector';

interface Case {
  states: string[];
  counted: number;
  charged: number;
  score: number;
  grade: string;
  status: 'scored' | 'partial' | 'not-scored';
  reason?: string;
}
const scored = (states: string[], charged: number, score: number, grade: string): Case => {
  const counted = states.filter((s) => !s.startsWith('excluded-')).length;
  return { states, counted, charged, score, grade, status: 'scored' };
};
const notScored = (states: string[]): Case => ({ states, counted: 0, charged: 0, score: 0, grade: 'F', status: 'not-scored', reason: 'no-counted-tests' });

const CASES: Record<string, Case> = {
  empty: scored(['excluded-empty', 'clean', 'issue'], 1, 50, 'F'),
  skipped: scored(['excluded-skipped', 'excluded-skipped', 'clean', 'issue'], 1, 50, 'F'),
  fixme: scored(['excluded-skipped', 'clean', 'issue'], 1, 50, 'F'),
  'describe-skip': scored(['excluded-skipped', 'clean', 'issue'], 1, 50, 'F'),
  'conditional-skip': scored(['issue', 'clean'], 1, 50, 'F'),
  hook: scored(['issue', 'issue', 'clean'], 2, 33, 'F'),
  'describe-level': scored(['clean', 'clean'], 0, 100, 'A'),
  'counted-zero': notScored(['excluded-skipped', 'excluded-empty']),
  'all-files-skipped': notScored(['excluded-skipped', 'excluded-skipped']),
  'parse-error-only': notScored([]),
  partial: { ...scored(['clean', 'issue'], 1, 50, 'F'), status: 'partial' },
  unasserted: scored(['unasserted', 'clean'], 0, 100, 'A'),
  unverified: scored(['unverified', 'issue'], 1, 50, 'F'),
  'weak-only': scored(['issue', 'clean', 'clean'], 1, 67, 'D'),
};
const SUITES = Object.keys(CASES).flatMap((c) => ['ts', 'js'].map((form) => ({ c, form, dir: path.join(fixtures, `${c}-${form}`) })));

const run = (dir: string): Promise<ScoreResult> => scorePaths({ paths: [dir], cwd: dir });
const cache = new Map<string, Promise<ScoreResult>>();
const result = (dir: string): Promise<ScoreResult> => {
  if (!cache.has(dir)) cache.set(dir, run(dir));
  return cache.get(dir)!;
};
async function withUnassertedCertain<T>(fn: () => Promise<T>): Promise<T> {
  tierOverrides.set(UNASSERTED_CELL, 'certain');
  try {
    return await fn();
  } finally {
    tierOverrides.delete(UNASSERTED_CELL);
  }
}

const sameRef = (r: FindingRef, f: Finding): boolean =>
  r.rule === f.rule && r.form === f.form && r.file === f.file && r.line === f.line && r.column === f.column;
const lookup = (res: ScoreResult, r: FindingRef): Finding[] => res.findings.filter((f) => sameRef(r, f));

/**
 * The trace check (restated in s9a/trace.py for run directories): counted - clean equals the
 * counted tests with a certain spec-file finding in their span or an in-scope hook, plus the
 * charged unasserted tests, and every point lost names a finding or a state.
 */
function trace(res: ScoreResult): string[] {
  const bad: string[] = [];
  const states = res.testStates ?? [];
  const counted = states.filter((s) => !s.state.startsWith('excluded-'));
  const charge = res.summary.unassertedCharged === true;
  let lost = 0;
  for (const s of counted) {
    const own = res.findings.filter((f) => f.tier === 'certain' && f.scope === 'test' && f.testKey === s.testKey && f.rule !== UNASSERTED_RULE);
    const refs = s.chargedBy ?? [];
    for (const r of refs) {
      const hits = lookup(res, r);
      if (hits.length === 0) bad.push(`${s.testKey}: chargedBy names no finding (${r.rule} ${r.line})`);
      for (const f of hits) {
        if (f.tier !== 'certain') bad.push(`${s.testKey}: charged by a ${f.tier} finding`);
        if (f.scope !== 'test' && f.scope !== 'hook') bad.push(`${s.testKey}: charged by a ${f.scope} finding`);
        if (f.file !== s.file) bad.push(`${s.testKey}: charged by a finding in ${f.file}`);
      }
    }
    for (const f of own) if (!refs.some((r) => sameRef(r, f))) bad.push(`${s.testKey}: certain finding ${f.rule}:${f.line} in the span does not charge it`);
    const unasserted = s.state === 'unasserted' && charge;
    if (unasserted && !res.findings.some((f) => f.rule === UNASSERTED_RULE && f.testKey === s.testKey && f.tier === 'certain')) bad.push(`${s.testKey}: charged unasserted without its finding`);
    if (s.state === 'issue' && refs.length === 0) bad.push(`${s.testKey}: issue names no finding`);
    if (s.state !== 'issue' && refs.length > 0) bad.push(`${s.testKey}: ${s.state} carries chargedBy`);
    if (s.state === 'issue' || unasserted) lost++;
  }
  if (res.summary.countedTests !== counted.length) bad.push(`countedTests ${res.summary.countedTests} != ${counted.length}`);
  if (res.summary.chargedTests !== lost) bad.push(`chargedTests ${res.summary.chargedTests} != ${lost}`);
  const want = counted.length === 0 ? 0 : Math.round((100 * (counted.length - lost)) / counted.length);
  if (res.score !== want) bad.push(`score ${res.score} != ${want}`);
  if ((res.status === 'not-scored') !== (counted.length === 0 || res.coverage?.filesFound === 0)) bad.push(`status ${res.status} with ${counted.length} counted`);
  return bad;
}

/** The property check: the score recomputed from the states and the certain findings only. */
function scoreFromCertain(res: ScoreResult): number {
  const certain: ScoreResult = { ...res, findings: res.findings.filter((f) => f.tier === 'certain') };
  const counted = (res.testStates ?? []).filter((s) => !s.state.startsWith('excluded-'));
  if (counted.length === 0) return 0;
  const charged = counted.filter(
    (s) =>
      (s.chargedBy ?? []).some((r) => lookup(certain, r).length > 0) ||
      (s.state === 'unasserted' && certain.findings.some((f) => f.rule === UNASSERTED_RULE && f.testKey === s.testKey))
  ).length;
  return Math.round((100 * (counted.length - charged)) / counted.length);
}

describe('QAG-287 S9a: score model v5 from test states', () => {
  for (const { c, form, dir } of SUITES) {
    it(`${c} (${form}): ${CASES[c].states.join(', ') || 'no test'} -> ${CASES[c].status} ${CASES[c].score}`, async () => {
      const want = CASES[c];
      const r = await result(dir);
      assert.equal(r.scoreVersion, 'v5');
      assert.deepEqual((r.testStates ?? []).map((s) => s.state), want.states);
      assert.equal(r.status, want.status);
      assert.equal(r.reason, want.reason);
      assert.equal(r.summary.countedTests, want.counted);
      assert.equal(r.summary.chargedTests, want.charged);
      assert.equal(r.score, want.score);
      assert.equal(r.grade, want.grade);
      // QAG-287 S9c: the default gate. Only weak-only has a certain passes-regardless finding
      // (no-weak-assertion) in a counted test; the others' certain findings are flake-risk
      // (no-wait-for-selector), which the default gate does not name. No threshold: 0.
      assert.equal(r.pass, want.status === 'scored' && c !== 'weak-only');
      assert.equal(r.threshold, 0);
      assert.equal(r.summary.unassertedCharged, false, 'the unasserted cell is not certain in the committed file');
      assert.deepEqual(r.locators, { native: r.summary.nativeLocators, raw: r.summary.rawLocators, scored: false });
      for (const k of ['playwrightHygiene', 'assertions', 'locators', 'structure'] as const) assert.equal(typeof r.dimensions[k], 'number');
      assert.deepEqual(trace(r), []);
      assert.equal(scoreFromCertain(r), r.score, 'removing every non-certain finding leaves the score unchanged');
    });
  }

  it('a skipped or fixme test is not charged for a certain finding inside it', async () => {
    for (const c of ['skipped', 'fixme', 'describe-skip', 'counted-zero']) {
      for (const form of ['ts', 'js']) {
        const r = await result(path.join(fixtures, `${c}-${form}`));
        const excluded = new Set((r.testStates ?? []).filter((s) => s.state === 'excluded-skipped').map((s) => s.testKey));
        const inside = r.findings.filter((f) => f.rule === WAIT && f.tier === 'certain' && excluded.has(f.testKey ?? ''));
        assert.ok(inside.length >= 1, `${c}-${form}: the fixture puts a certain finding in a skipped test`);
        assert.deepEqual(r.outsideTests, [], `${c}-${form}`);
      }
    }
  });

  it('a certain finding in a hook charges every counted test in its scope, and names the finding', async () => {
    for (const form of ['ts', 'js']) {
      const r = await result(path.join(fixtures, `hook-${form}`));
      const source = fs.readFileSync(path.join(fixtures, `hook-${form}`, `a.spec.${form}`), 'utf8').split('\n');
      const hookLine = source.findIndex((l) => l.includes("waitForSelector('#account')")) + 1;
      const hookFinding = r.findings.filter((f) => f.rule === WAIT && f.line === hookLine);
      assert.equal(hookFinding.length, 1);
      assert.equal(hookFinding[0].scope, 'hook');
      assert.equal(hookFinding[0].tier, 'certain');
      const [a, b, outside] = r.testStates!;
      for (const s of [a, b]) assert.deepEqual(s.chargedBy, [{ rule: WAIT, form: '-', file: `a.spec.${form}`, line: hookLine, column: hookFinding[0].column }]);
      assert.equal(outside.chargedBy, undefined, 'the hook is not in scope for the test outside its describe');
    }
  });

  it('a certain finding outside every test and hook is listed, not charged', async () => {
    for (const form of ['ts', 'js']) {
      const r = await result(path.join(fixtures, `describe-level-${form}`));
      const source = fs.readFileSync(path.join(fixtures, `describe-level-${form}`, `a.spec.${form}`), 'utf8').split('\n');
      const lines = source.flatMap((l, i) => (l.includes('waitForSelector') ? [i + 1] : []));
      assert.equal(lines.length, 2, 'one in a spec-local test.extend, one in a describe body');
      assert.deepEqual(r.outsideTests?.map((o) => [o.rule, o.file, o.line]), lines.map((l) => [WAIT, `a.spec.${form}`, l]));
      for (const o of r.outsideTests!) {
        const f = lookup(r, o);
        assert.equal(f.length, 1);
        assert.equal(f[0].tier, 'certain');
        assert.ok(f[0].scope === 'module' || f[0].scope === undefined);
      }
      assert.equal(r.score, 100);
      assert.equal(r.summary.chargedTests, 0);
    }
  });

  it('a weak assertion alone makes the test an issue; a likely finding in a test does not charge it', async () => {
    for (const form of ['ts', 'js']) {
      const r = await result(path.join(fixtures, `weak-only-${form}`));
      const [weak, paused] = r.testStates!;
      assert.deepEqual(weak.chargedBy?.map((x) => x.rule), ['pwscore/no-weak-assertion']);
      const likely = r.findings.filter((f) => f.testKey === paused.testKey && f.rule === 'playwright/no-wait-for-timeout');
      assert.equal(likely.length, 1);
      assert.notEqual(likely[0].tier, 'certain');
      assert.equal(paused.state, 'clean');
    }
  });

  it('unasserted in fallback: listed, clean for the score, and recorded as not charged', async () => {
    for (const form of ['ts', 'js']) {
      const r = await result(path.join(fixtures, `unasserted-${form}`));
      assert.equal(r.summary.unassertedCharged, false);
      assert.equal(r.summary.unassertedTests, 1);
      const f = r.findings.filter((x) => x.rule === UNASSERTED_RULE);
      assert.equal(f.length, 1);
      assert.notEqual(f[0].tier, 'certain');
      assert.equal(r.score, 100);
    }
  });

  it('unasserted charged: with the cell certain (catalogue test seam), the test costs its share', async () => {
    for (const form of ['ts', 'js']) {
      const r = await withUnassertedCertain(() => run(path.join(fixtures, `unasserted-${form}`)));
      assert.equal(r.summary.unassertedCharged, true);
      assert.deepEqual(r.testStates!.map((s) => s.state), ['unasserted', 'clean']);
      assert.equal(r.summary.chargedTests, 1);
      assert.equal(r.score, 50);
      assert.equal(r.grade, 'F');
      assert.equal(r.pass, false);
      const f = r.findings.filter((x) => x.rule === UNASSERTED_RULE);
      assert.equal(f.length, 1);
      assert.equal(f[0].tier, 'certain');
      assert.deepEqual(trace(r), []);
      assert.equal(scoreFromCertain(r), r.score);
    }
    // The seam is cleared again: the committed tier is back.
    const again = await run(path.join(fixtures, 'unasserted-ts'));
    assert.equal(again.summary.unassertedCharged, false);
    assert.equal(again.score, 100);
  });

  it('with the cell certain, only the unasserted suites change, and the findings stay the same apart from that tier', async () => {
    for (const { c, dir } of SUITES) {
      const base = await result(dir);
      const r = await withUnassertedCertain(() => run(dir));
      const plain = (x: ScoreResult) => x.findings.map((f) => `${f.rule}|${f.file}|${f.line}|${f.column}|${f.message}`).sort();
      assert.deepEqual(plain(r), plain(base), dir);
      const hasUnasserted = (base.testStates ?? []).some((s) => s.state === 'unasserted');
      if (!hasUnasserted) assert.equal(r.score, base.score, dir);
      else assert.ok(r.score < base.score, `${c}: charging unasserted lowers the score`);
    }
  });

  it('a shared-file finding never charges a test and is not listed outside tests (synthetic)', async () => {
    const dir = path.join(fixtures, 'hook-ts');
    const file = path.join(dir, 'a.spec.ts');
    const source = fs.readFileSync(file, 'utf8');
    const base = await result(dir);
    const cleanTest = base.testStates!.find((s) => s.state === 'clean')!;
    const shared: Finding = {
      rule: WAIT,
      severity: 'warning',
      message: 'Avoid waitForSelector.',
      file: 'pages/account-page.ts',
      line: cleanTest.line + 1,
      column: 5,
      dimension: 'playwrightHygiene',
      scope: 'shared',
      usedBy: ['a.spec.ts'],
      // Adversarial: a shared finding that also carries the clean test's key.
      testKey: cleanTest.testKey,
      form: '-',
      tier: 'certain',
      family: 'passes-regardless',
    };
    const fresh = JSON.parse(JSON.stringify({ ...base, testStates: undefined })) as ScoreResult;
    fresh.findings = fresh.findings.filter((f) => f.rule !== UNASSERTED_RULE);
    fresh.findings.push(shared);
    stageTestStates(fresh, { ctx: { filesBase: dir, sources: new Map([[file, source]]) }, fileSpans: new Map([['a.spec.ts', getTestSpans(source, file)]]), findings: fresh.findings });
    settleTestStates(fresh);
    applyStateScore(fresh);
    assert.deepEqual(fresh.testStates, base.testStates);
    assert.equal(fresh.score, base.score);
    assert.equal(fresh.summary.chargedTests, base.summary.chargedTests);
    assert.deepEqual(fresh.outsideTests, base.outsideTests);
    // Control: the same finding with scope `test` does charge the clean test.
    const control = JSON.parse(JSON.stringify({ ...base, testStates: undefined })) as ScoreResult;
    control.findings = control.findings.filter((f) => f.rule !== UNASSERTED_RULE);
    control.findings.push({ ...shared, file: 'a.spec.ts', scope: 'test', usedBy: undefined });
    stageTestStates(control, { ctx: { filesBase: dir, sources: new Map([[file, source]]) }, fileSpans: new Map([['a.spec.ts', getTestSpans(source, file)]]), findings: control.findings });
    settleTestStates(control);
    applyStateScore(control);
    assert.equal(control.testStates!.find((s) => s.testKey === cleanTest.testKey)!.state, 'issue');
    assert.ok(control.score < base.score);
  });

  it('the trace and property checks fail on a result that breaks them (controls)', async () => {
    const r = JSON.parse(JSON.stringify(await result(path.join(fixtures, 'hook-ts')))) as ScoreResult;
    // A charge that rests on a non-certain finding: the property check moves.
    const hook = r.findings.find((f) => f.scope === 'hook' && f.rule === WAIT)!;
    hook.tier = 'likely';
    assert.notEqual(scoreFromCertain(r), r.score);
    assert.ok(trace(r).some((m) => m.includes('charged by a likely finding')));
    // A score that does not follow the states: the trace check moves.
    const s = JSON.parse(JSON.stringify(await result(path.join(fixtures, 'weak-only-js')))) as ScoreResult;
    s.score = 100;
    assert.ok(trace(s).some((m) => m.startsWith('score 100')));
  });

  it('the CLI exits 1 on a not-scored suite and prints status and reason', async () => {
    for (const c of ['counted-zero', 'all-files-skipped', 'parse-error-only']) {
      const dir = path.join(fixtures, `${c}-js`);
      let code = 0;
      let out = '';
      try {
        out = (await execFileAsync(process.execPath, [path.join(root, 'dist', 'cli.js'), dir, '--format', 'json'])).stdout;
      } catch (e) {
        const err = e as { code?: number; stdout?: string };
        code = err.code ?? -1;
        out = err.stdout ?? '';
      }
      assert.equal(code, 1, c);
      const json = JSON.parse(out) as ScoreResult;
      assert.equal(json.status, 'not-scored');
      assert.equal(json.reason, 'no-counted-tests');
      assert.equal(json.score, 0);
      assert.equal(json.pass, false);
    }
  });
});
