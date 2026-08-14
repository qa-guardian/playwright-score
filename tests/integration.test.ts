import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'fixtures'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const root = packageRoot();
const fixtures = path.join(root, 'fixtures');

describe('scorePaths integration', () => {
  it('scores good-standard highly', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.scoreVersion, 'sqs-v1');
    assert.ok(result.score >= 80, `expected >=80 got ${result.score}: ${JSON.stringify(result.findings.slice(0, 5))}`);
    assert.equal(result.pass, true);
  });

  it('penalizes hard waits', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-waits.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule.includes('wait-for-timeout') || f.rule.includes('force')),
      `expected wait/force findings, got: ${result.findings.map((f) => f.rule).join(', ')}`
    );
    assert.ok(result.score < 100);
  });

  it('flags no expects', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-no-expects.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      result.findings.some(
        (f) =>
          f.rule === 'metrics/no-empty-test' ||
          f.rule === 'playwright/expect-expect' ||
          f.rule.includes('expect')
      ),
      `expected expect findings: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian flags Date.now', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-date-now.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/no-date-now-id'),
      `expected date-now rule: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian flags hardcoded secrets', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-hardcoded-secret.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/no-hardcoded-secrets'),
      `expected hardcoded-secrets rule: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian flags non-standard timeout values', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-long-timeout.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/no-generic-long-timeout'),
      `expected long-timeout rule: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian flags more than one describe/test per file', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-multi-describe.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/one-describe-one-test'),
      `expected one-describe-one-test rule: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian suggests test.step when missing', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-no-test-step.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/require-test-step'),
      `expected require-test-step rule: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian flags waitForLoadState', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-wait-for-load-state.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/no-wait-for-load-state'),
      `expected no-wait-for-load-state rule: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('locator ratio is low for raw-heavy file', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-raw-locators.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      result.dimensions.locators <= 40,
      `expected low locator ratio score, got ${result.dimensions.locators}`
    );
  });

  it('double-run is deterministic', async () => {
    const file = path.join(fixtures, 'bad-waits.spec.ts');
    const a = await scorePaths({ paths: [file], profile: 'standard', cwd: root });
    const b = await scorePaths({ paths: [file], profile: 'standard', cwd: root });
    assert.equal(a.score, b.score);
    assert.equal(a.summary.findings, b.summary.findings);
    assert.deepEqual(a.dimensions, b.dimensions);
  });

  it('finds ESLint issues even when caller cwd is unrelated to the file (regression: basePath bug)', async () => {
    // Real-world shape of the bug this guards: a host process (e.g. the
    // Guardian runner) calls scorePaths with its own install dir as cwd,
    // which has nothing to do with where the spec file lives. ESLint 9
    // flat config silently drops files outside its basePath (derived from
    // cwd) with no visible error — score looked "clean" for every file,
    // 100% of the time, regardless of real content.
    const file = path.join(fixtures, 'bad-waits.spec.ts');
    const unrelatedCwd = os.tmpdir();
    const result = await scorePaths({
      paths: [file],
      profile: 'standard',
      threshold: 80,
      cwd: unrelatedCwd,
    });
    assert.ok(
      result.findings.some((f) => f.rule.includes('wait-for-timeout') || f.rule.includes('force')),
      `expected wait/force findings even with unrelated cwd, got: ${result.findings.map((f) => f.rule).join(', ')}`
    );
    assert.ok(result.score < 100);
  });

  it('no matching files hard-fails with score 0', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'does-not-exist-xyz.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.score, 0);
    assert.equal(result.grade, 'F');
    assert.equal(result.pass, false);
    assert.ok(
      result.findings.some((f) => f.rule === 'playwright-score/no-files'),
      'expected no-files finding'
    );
  });
});
