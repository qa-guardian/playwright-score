import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';

// QAG-287 slice 2b: flake-risk rules and the test-factory alias fix.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}
const fixtures = path.join(packageRoot(), 'fixtures');

async function findings(rel: string, rule: string) {
  const r = await scorePaths({
    paths: [path.join(fixtures, rel)],
    profile: 'standard',
    threshold: 0,
    cwd: fixtures,
  });
  return r.findings.filter((f) => f.rule === rule);
}

describe('QAG-287 2b: pwscore/no-unawaited-action', () => {
  it('fires on goto, a locator-chain click and a const-locator fill', async () => {
    const f = await findings('flake-risk/bad-unawaited-action.spec.ts', 'pwscore/no-unawaited-action');
    assert.equal(f.length, 3, JSON.stringify(f));
    assert.ok(f.every((x) => x.severity === 'error'));
  });
  it('stays clean for awaited, Promise.all, assigned, void and non-Playwright receivers', async () => {
    const f = await findings('flake-risk/good-awaited-action.spec.ts', 'pwscore/no-unawaited-action');
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});

describe('QAG-287 2b: pwscore/no-brittle-selector', () => {
  it('fires on xpath, nth-child, long chain, generated classes and positional raw locators; report-only', async () => {
    const f = await findings('flake-risk/bad-brittle-selectors.spec.ts', 'pwscore/no-brittle-selector');
    assert.equal(f.length, 7, JSON.stringify(f));
    assert.ok(f.every((x) => x.reportOnly === true && x.severity === 'warning'));
  });
  it('stays clean for role/testid/short css/text selectors', async () => {
    const f = await findings('flake-risk/good-stable-selectors.spec.ts', 'pwscore/no-brittle-selector');
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});

describe('QAG-287 2b: pwscore/no-shared-mutable-state', () => {
  it('fires when one test writes and another reads (no serial mode)', async () => {
    const f = await findings('flake-risk/bad-shared-state.spec.ts', 'pwscore/no-shared-mutable-state');
    assert.equal(f.length, 2, JSON.stringify(f)); // createdId and seen
  });
  it('serial mode is report-only info and exempts the shared state it declares', async () => {
    for (const file of ['good-serial-describe', 'good-serial-configure-file', 'good-serial-configure-describe']) {
      const f = await findings(`flake-risk/${file}.spec.ts`, 'pwscore/no-shared-mutable-state');
      assert.equal(f.length, 0, `${file}: ${JSON.stringify(f)}`);
      const s = await findings(`flake-risk/${file}.spec.ts`, 'pwscore/serial-mode-dependency');
      assert.equal(s.length, 1, file);
      assert.equal(s[0].severity, 'info');
      assert.equal(s[0].reportOnly, true);
    }
  });
  it('still fires in a non-serial describe next to a serial one', async () => {
    const f = await findings('flake-risk/bad-shared-state-beside-serial.spec.ts', 'pwscore/no-shared-mutable-state');
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.match(f[0].message, /`id`/);
  });
  it('module-level state shared by tests that are all inside a serial describe is exempt', async () => {
    for (const file of ['good-serial-module-var-configure', 'good-serial-module-var-describe-serial']) {
      const f = await findings(`flake-risk/${file}.spec.ts`, 'pwscore/no-shared-mutable-state');
      assert.equal(f.length, 0, `${file}: ${JSON.stringify(f)}`);
    }
  });
  it('module-level state written in a serial describe and read outside it still fires', async () => {
    const f = await findings('flake-risk/bad-shared-module-var-serial-writer-only.spec.ts', 'pwscore/no-shared-mutable-state');
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.match(f[0].message, /`bookingId`/);
  });
  it('stays clean for beforeEach setup, own-test writes and test-local state', async () => {
    const f = await findings('flake-risk/good-isolated-state.spec.ts', 'pwscore/no-shared-mutable-state');
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});

describe('QAG-287 2b: pwscore/no-excessive-timeout', () => {
  it('fires on long option timeouts, setTimeout >= 5 min and unconditional test.slow()', async () => {
    const f = await findings('flake-risk/bad-excessive-timeout.spec.ts', 'pwscore/no-excessive-timeout');
    assert.equal(f.length, 5, JSON.stringify(f));
  });
  it('stays clean for sane timeouts and conditional slow', async () => {
    const f = await findings('flake-risk/good-sane-timeout.spec.ts', 'pwscore/no-excessive-timeout');
    assert.equal(f.length, 0, JSON.stringify(f));
  });
  it('does not flag a round 60 second timeout, only strictly more', async () => {
    const f = await findings('flake-risk/good-excessive-timeout-60s.spec.ts', 'pwscore/no-excessive-timeout');
    assert.equal(f.length, 0, JSON.stringify(f));
  });
});

describe('QAG-287 2b: tests declared through a factory function', () => {
  it('a factory in a sibling file (direct and nested) makes its call result a test alias', async () => {
    const f = await findings('test-factory/good-factory.spec.ts', 'playwright/no-standalone-expect');
    assert.equal(f.length, 0, JSON.stringify(f));
  });
  it('twin: a function that does not return a test is not an alias', async () => {
    const f = await findings('test-factory/bad-not-a-factory.spec.ts', 'playwright/no-standalone-expect');
    assert.ok(f.length >= 1, JSON.stringify(f));
  });
});

describe('QAG-287: curried test-factory calls factory({...})("title", fn)', () => {
  async function run(rel: string) {
    return scorePaths({ paths: [path.join(fixtures, rel)], profile: 'standard', threshold: 0, cwd: fixtures });
  }
  it('factory imported from a helper file: no standalone-expect, three tests counted (plain, .only, .skip)', async () => {
    const r = await run('test-factory/good-curried.spec.ts');
    assert.deepEqual(r.findings.filter((f) => f.rule === 'playwright/no-standalone-expect'), []);
    assert.equal(r.summary.tests, 3);
  });
  it('factory defined in the same file', async () => {
    const r = await run('test-factory/good-curried-same-file.spec.ts');
    assert.deepEqual(r.findings.filter((f) => f.rule === 'playwright/no-standalone-expect'), []);
    assert.equal(r.summary.tests, 1);
  });
  it('a curried test is eligible for our own rules (no-unawaited-action)', async () => {
    const r = await run('test-factory/bad-curried-unawaited.spec.ts');
    assert.equal(r.summary.tests, 1);
    const f = r.findings.filter((x) => x.rule === 'pwscore/no-unawaited-action');
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.equal(f[0].scope, 'test');
  });
  it('NEGATIVE: curried calls whose inner callee is not a known factory change nothing', async () => {
    const r = await run('test-factory/bad-curried-unknown.spec.ts');
    assert.equal(r.summary.tests, 0);
    assert.equal(r.findings.filter((f) => f.rule === 'playwright/no-standalone-expect').length, 2);
  });
  it('an expect in the factory options object stays standalone', async () => {
    const r = await run('test-factory/bad-curried-options-expect.spec.ts');
    assert.equal(r.findings.filter((f) => f.rule === 'playwright/no-standalone-expect').length, 1);
  });
});
