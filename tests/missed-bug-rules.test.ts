import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';

// QAG-287 slice 2a: tests that would miss a real bug. Each rule has a bad
// fixture that must fire and a good twin that must stay clean.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const dir = path.join(packageRoot(), 'fixtures', 'missed-bug');

async function hits(file: string, rule: string) {
  const r = await scorePaths({
    paths: [path.join(dir, file)],
    profile: 'standard',
    threshold: 0,
    cwd: dir,
  });
  return { all: r.findings, own: r.findings.filter((f) => f.rule === rule) };
}

const CASES: Array<[string, string, number]> = [
  ['no-fixme-test', 'fixme', 2],
  ['no-swallowed-assertion', 'swallowed', 2],
  ['no-weak-assertion', 'weak', 5],
  ['no-unawaited-expect-value', 'unawaited-value', 3],
];

for (const [rule, stem, count] of CASES) {
  describe(`QAG-287 2a: pwscore/${rule}`, () => {
    it('fires on the bad fixture', async () => {
      const { own, all } = await hits(`bad-${stem}.spec.ts`, `pwscore/${rule}`);
      assert.equal(own.length, count, JSON.stringify(all));
    });
    it('stays clean on the good twin', async () => {
      const { own, all } = await hits(`good-${stem}.spec.ts`, `pwscore/${rule}`);
      assert.equal(own.length, 0, JSON.stringify(all));
    });
  });
}

describe('QAG-287 fix round 1: no-swallowed-assertion log-only catch', () => {
  it('reports a catch that only logs (console.*, logger.*)', async () => {
    const { own, all } = await hits('bad-swallowed-logonly.spec.ts', 'pwscore/no-swallowed-assertion');
    assert.equal(own.length, 2, JSON.stringify(all));
  });
  it('does not report a catch that throws, expects, test.fail or assert.fail', async () => {
    const { own, all } = await hits('good-swallowed-propagates.spec.ts', 'pwscore/no-swallowed-assertion');
    assert.equal(own.length, 0, JSON.stringify(all));
  });
});

describe('QAG-287 fix round 2: no-swallowed-assertion skip in catch', () => {
  it('does not report a catch that calls test.skip(...)', async () => {
    const { own, all } = await hits('good-swallowed-skip.spec.ts', 'pwscore/no-swallowed-assertion');
    assert.equal(own.length, 0, JSON.stringify(all));
  });
  it('still reports an empty catch and a page-action-only catch', async () => {
    const { own, all } = await hits('bad-swallowed-empty-or-action.spec.ts', 'pwscore/no-swallowed-assertion');
    assert.equal(own.length, 2, JSON.stringify(all));
  });
});

describe('QAG-287 2a: severities and de-duplication', () => {
  it('weak/unawaited are errors; swallowed is a warning', async () => {
    const w = await hits('bad-weak.spec.ts', 'pwscore/no-weak-assertion');
    assert.ok(w.own.every((f) => f.severity === 'error' && f.dimension === 'assertions'));
    const sw = await hits('bad-swallowed.spec.ts', 'pwscore/no-swallowed-assertion');
    assert.ok(sw.own.every((f) => f.severity === 'warning' && f.dimension === 'assertions'));
  });

  it('un-awaited value says the await is missing and prefer-web-first-assertions does not double-report', async () => {
    const { own, all } = await hits('bad-unawaited-value.spec.ts', 'pwscore/no-unawaited-expect-value');
    assert.ok(own.every((f) => /Missing await/.test(f.message)));
    assert.equal(all.filter((f) => f.rule === 'playwright/prefer-web-first-assertions').length, 0, JSON.stringify(all));
  });
});
