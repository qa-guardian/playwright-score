import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';

// QAG-287 slice 1: findings the scorer got wrong on public suites. Every
// "good" fixture must come out clean, every "bad" twin must still fire.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const fixtures = path.join(packageRoot(), 'fixtures');

async function score(...rel: string[]) {
  return scorePaths({
    paths: rel.map((r) => path.join(fixtures, r)),
    profile: 'standard',
    threshold: 0,
    cwd: fixtures,
  });
}

const rules = (r: { findings: Array<{ rule: string }> }) => r.findings.map((f) => f.rule);

describe('QAG-287: expect-expect resolution', () => {
  it('a fixture injected through the test args that asserts counts as an assertion', async () => {
    const r = await score('good-standard-fixture-assertion.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it('a page-object method in a readable imported file counts as an assertion', async () => {
    const r = await score('page-object-delegation/good-imported-page-object.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it('a call on an unreadable injected object becomes a report-only human-check finding', async () => {
    const r = await score('good-standard-unresolved-fixture-call.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright/expect-expect'));
    const f = r.findings.find((x) => x.rule === 'playwright-score/assertion-unverified');
    assert.ok(f, JSON.stringify(r.findings));
    assert.equal(f.reportOnly, true);
    assert.equal(f.severity, 'info');
    assert.match(f.message, /Needs a human check/);
    assert.equal(r.summary.unassertedTests, 0);
  });

  it('twin: only goto/click on page still errors', async () => {
    const r = await score('bad-standard-actions-only.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 2, JSON.stringify(r.findings));
    assert.ok(r.score < 100);
    assert.equal(r.summary.unassertedTests, 2);
  });

  it('twin: a readable page-object method that does not assert still errors', async () => {
    const r = await score('page-object-delegation/bad-readable-page-object.spec.ts');
    assert.ok(rules(r).includes('playwright/expect-expect'), JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright-score/assertion-unverified'));
  });
});

describe('QAG-287: no-trivial-assertion', () => {
  it('an array filled by a listener is a real assertion', async () => {
    const r = await score('good-standard-listener-collected-array.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('pwscore/no-trivial-assertion'));
  });

  it('twin: constants and never-touched arrays are still flagged', async () => {
    const r = await score('bad-standard-constant-array.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'pwscore/no-trivial-assertion').length, 2, JSON.stringify(r.findings));
  });
});

describe('QAG-287: no-timer-sleep', () => {
  it('a retry/backoff pause in a helper function is not flagged', async () => {
    const r = await score('good-standard-retry-backoff-helper.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('pwscore/no-timer-sleep'));
  });

  it('twin: sleeps in a test body, a hook, a loop in a test and a bare sleep helper are flagged', async () => {
    const r = await score('bad-standard-sleep-in-test.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'pwscore/no-timer-sleep').length, 4, JSON.stringify(r.findings));
  });
});

describe('QAG-287: no-conditional-in-test', () => {
  it('a guard whose only body is throw is not flagged', async () => {
    const r = await score('good-standard-throw-guard.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright/no-conditional-in-test'));
  });

  it('twin: real branching is still flagged', async () => {
    const r = await score('bad-standard-real-branching.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/no-conditional-in-test').length, 2, JSON.stringify(r.findings));
  });
});
