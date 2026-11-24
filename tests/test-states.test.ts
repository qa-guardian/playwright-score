import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { defaultRow, tierOf } from '../src/catalogue/table.js';
import { testStates, testStateStats, UNASSERTED_RULE } from '../src/test-states.js';
import type { ScoreResult } from '../src/types.js';

// QAG-287 S12: one state per test. tests/data/test-states.json pins, for every fixture under
// tests/fixtures/cells/pwscore__unasserted, the state of each of its tests in source order
// (and the unresolved names of an unverified test). The states are written out there, never
// derived from the code under test.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const cells = path.join(root, 'tests', 'fixtures', 'cells');
type Expected = Record<string, { states: string[]; unresolved?: string[][] }>;
const expected = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'data', 'test-states.json'), 'utf8')) as Expected;
const entries = Object.keys(expected).sort();

const run = (entry: string): Promise<ScoreResult> => scorePaths({ paths: [path.join(cells, entry)], profile: 'standard', threshold: 0, cwd: cells });
const cache = new Map<string, Promise<ScoreResult>>();
const scored = (entry: string): Promise<ScoreResult> => {
  if (!cache.has(entry)) cache.set(entry, run(entry));
  return cache.get(entry)!;
};
const unasserted = (r: ScoreResult) => r.findings.filter((f) => f.rule === UNASSERTED_RULE);

describe('QAG-287 S12: test states', () => {
  it('the table covers every state, in TypeScript and in JavaScript', () => {
    for (const ext of ['.ts', '.js']) {
      const seen = new Set(entries.filter((e) => e.endsWith(ext)).flatMap((e) => expected[e].states));
      assert.deepEqual([...seen].sort(), ['clean', 'excluded-empty', 'excluded-skipped', 'issue', 'unasserted', 'unverified'], ext);
    }
    assert.ok(entries.length >= 50);
  });

  for (const entry of entries) {
    it(`${entry}: ${expected[entry].states.join(', ')}`, async () => {
      const r = await scored(entry);
      const states = r.testStates ?? [];
      assert.deepEqual(states.map((s) => s.state), expected[entry].states);
      assert.equal(states.length, r.summary.tests, 'one entry per counted test');
      const unverified = states.filter((s) => s.state === 'unverified');
      if (expected[entry].unresolved) assert.deepEqual(unverified.map((s) => s.unresolved), expected[entry].unresolved);
      for (const s of states) assert.equal(s.unresolved !== undefined, s.state === 'unverified', 'only an unverified test names callees');
      // One finding per unasserted test, at its declaration, report-only and never certain.
      const want = states.filter((s) => s.state === 'unasserted');
      const got = unasserted(r);
      assert.deepEqual(got.map((f) => [f.file, f.line, f.testKey]), want.map((s) => [s.file, s.line, s.testKey]));
      assert.equal(r.summary.unassertedTests, want.length);
      for (const f of got) {
        assert.equal(f.reportOnly, true);
        assert.equal(f.tier, 'likely');
        assert.equal(f.family, 'passes-regardless');
        assert.equal(f.form, '-');
        assert.ok(typeof f.column === 'number' && f.column >= 1);
        assert.ok(f.title && f.what && f.why && f.fix);
      }
    });
  }

  it('entries are sorted by file, then line, and a second run gives the same bytes', async () => {
    const paths = entries.map((e) => path.join(cells, e));
    const a = await scorePaths({ paths, profile: 'standard', threshold: 0, cwd: cells });
    const b = await scorePaths({ paths, profile: 'standard', threshold: 0, cwd: cells });
    assert.equal(JSON.stringify(a.testStates), JSON.stringify(b.testStates));
    const keys = (a.testStates ?? []).map((s) => [s.file, s.line] as const);
    assert.ok(keys.length >= entries.length);
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i - 1][0] < keys[i][0] || (keys[i - 1][0] === keys[i][0] && keys[i - 1][1] <= keys[i][1]), `${keys[i - 1]} before ${keys[i]}`);
    }
    console.log(`S12 parses: ${testStateStats.parses} files parsed by the step for the ${a.summary.files} spec files of the S12 fixtures scored in one run (${a.summary.tests} tests)`);
    assert.ok(testStateStats.parses >= a.summary.files);
  });

  it('with the step off, everything but the registered additions is the same', async () => {
    const strip = (r: ScoreResult) => ({ ...r, testStates: undefined, findings: r.findings.filter((f) => f.rule !== UNASSERTED_RULE && f.rule !== 'pwscore/loop-only-assertions'), summary: { ...r.summary, unassertedTests: 0 } });
    let added = 0;
    for (const entry of entries) {
      const on = await scored(entry);
      testStates.enabled = false;
      let off: ScoreResult;
      try {
        off = await run(entry);
      } finally {
        testStates.enabled = true;
      }
      assert.equal(off.testStates, undefined);
      assert.equal(unasserted(off).length, 0);
      assert.equal(JSON.stringify(strip(on)), JSON.stringify(strip(off)), entry);
      for (const k of ['score', 'grade', 'pass', 'status'] as const) assert.deepEqual((on as never)[k], (off as never)[k], `${entry} ${k}`);
      assert.deepEqual(on.dimensions, off.dimensions);
      added += unasserted(on).length;
    }
    assert.ok(added >= 15, 'the fixtures do add findings with the step on');
  });

  it('the catalogue cell is report-only and not certain', () => {
    const row = defaultRow(UNASSERTED_RULE);
    assert.ok(row);
    assert.equal(row!.family, 'passes-regardless');
    assert.equal(row!.bcEligible, false);
    assert.equal(row!.reportOnly, true);
    assert.equal(row!.basis, 'convention');
    assert.equal(tierOf(row!), 'likely');
  });
});
