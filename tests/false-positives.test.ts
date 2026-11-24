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

  it('an object-literal method of a fixture factory in an imported file counts as an assertion', async () => {
    const r = await score('page-object-delegation/good-factory-object-method.spec.ts');
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
    assert.match(f.message, /cannot decide this one automatically/);
    assert.equal(r.summary.unassertedTests, 0);
    assert.equal(r.summary.unverifiedTests, 1);
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

describe('QAG-287: valid-expect', () => {
  it('a helper named ...Expect is not an expect() without a matcher', async () => {
    const r = await score('good-standard-expect-named-helper.spec.ts');
    assert.equal(r.score, 100, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright/valid-expect'));
  });

  it('twin: a real expect() without a matcher is still flagged', async () => {
    const r = await score('bad-standard-expect-without-matcher.spec.ts');
    assert.ok(rules(r).includes('playwright/valid-expect'), JSON.stringify(r.findings));
  });
});

describe('QAG-287 fix round 1: holes that let a test with no assertion escape', () => {
  it('twin: methods on unreadable objects with non-assertion names stay expect-expect errors', async () => {
    const r = await score('bad-standard-unreadable-non-assertion-calls.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 3, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright-score/assertion-unverified'), JSON.stringify(r.findings));
    // QAG-287 S12: unassertedTests counts the test state `unasserted`. Every call here is on an
    // object from a package this scan cannot read, so all three tests are `unverified` instead.
    assert.equal(r.summary.unassertedTests, 0);
    assert.deepEqual((r.testStates ?? []).map((s) => s.state), ['unverified', 'unverified', 'unverified']);
    assert.equal(r.summary.unverifiedTests, 0);
  });

  it('twin: a page override that asserts only in setup, or a fixture never called, or a spec that never imports the fixtures, does not assert', async () => {
    // Scored together on purpose: the unrelated spec must not inherit the
    // fixtures of a module only its sibling imports.
    const r = await score('fixture-scope/bad-page-override.spec.ts', 'fixture-scope/bad-unrelated-file.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 3, JSON.stringify(r.findings));
    assert.equal(r.summary.unassertedTests, 3);
  });

  it('twin: a helper named like a Playwright method does not make page.goto/fill count as assertions', async () => {
    const r = await score('helper-name-collision/bad-playwright-named-helper.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 1, JSON.stringify(r.findings));
  });

  it('twin: polling loops with no exit are still flagged as sleeps; a bounded retry loop (E2) is not', async () => {
    const r = await score('bad-standard-polling-sleep.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'pwscore/no-timer-sleep').length, 2, JSON.stringify(r.findings));
  });

  it('twin: a .length read or a same-named property is not a mutation of the asserted array', async () => {
    const r = await score('bad-standard-mutation-lookalike.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'pwscore/no-trivial-assertion').length, 2, JSON.stringify(r.findings));
  });

  it('an array passed to a callee or pushed to in a closure may be mutated, so its assertion is real', async () => {
    const r = await score('good-standard-mutation-by-callee.spec.ts');
    assert.ok(!rules(r).includes('pwscore/no-trivial-assertion'), JSON.stringify(r.findings));
  });
});

describe('QAG-287 fix round 2: more ways a test with no assertion escaped', () => {
  it('twin: an expect in a fixture setup does not turn a same-named page-object method into an assertion', async () => {
    const r = await score('round2/setup-expect-fixture/bad-setup-expect.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 1, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright-score/assertion-unverified'), JSON.stringify(r.findings));
  });

  it('a fixture called from an unresolved (tsconfig alias) module is unverified, not asserting and not an error', async () => {
    const r = await score('round2/alias/specs/alias.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 0, JSON.stringify(r.findings));
    assert.equal(rules(r).filter((x) => x === 'playwright-score/assertion-unverified').length, 1, JSON.stringify(r.findings));
    assert.equal(r.summary.unverifiedTests, 1);
  });

  it('twin: query names, built-ins and Playwright-named actions on unreadable objects stay expect-expect errors', async () => {
    const r = await score('round2/bad-assertion-lookalike-names.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright/expect-expect').length, 6, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright-score/assertion-unverified'), JSON.stringify(r.findings));
  });

  it('names that read like an assertion on an unreadable object are unverified', async () => {
    const r = await score('round2/good-assertion-like-names.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'playwright-score/assertion-unverified').length, 2, JSON.stringify(r.findings));
    assert.ok(!rules(r).includes('playwright/expect-expect'), JSON.stringify(r.findings));
  });

  it('an assertion-like call on a destructured name is unverified; twin: a non-assertion call stays an error', async () => {
    const good = await score('round2/good-destructure-assertion.spec.ts');
    assert.equal(rules(good).filter((x) => x === 'playwright-score/assertion-unverified').length, 1, JSON.stringify(good.findings));
    assert.ok(!rules(good).includes('playwright/expect-expect'), JSON.stringify(good.findings));
    const bad = await score('round2/bad-destructure-non-assertion.spec.ts');
    assert.equal(rules(bad).filter((x) => x === 'playwright/expect-expect').length, 1, JSON.stringify(bad.findings));
    assert.ok(!rules(bad).includes('playwright-score/assertion-unverified'), JSON.stringify(bad.findings));
  });

  it('an inner array mutated through an index makes the outer assertion real; twin: index reads do not', async () => {
    const good = await score('round2/good-mutation-through-index.spec.ts');
    assert.ok(!rules(good).includes('pwscore/no-trivial-assertion'), JSON.stringify(good.findings));
    const bad = await score('round2/bad-mutation-index-read.spec.ts');
    assert.equal(rules(bad).filter((x) => x === 'pwscore/no-trivial-assertion').length, 1, JSON.stringify(bad.findings));
  });

  it('twin: a loop around an empty try block is not a retry/backoff helper', async () => {
    const r = await score('round2/bad-empty-try-retry-sleep.spec.ts');
    assert.equal(rules(r).filter((x) => x === 'pwscore/no-timer-sleep').length, 1, JSON.stringify(r.findings));
  });
});
