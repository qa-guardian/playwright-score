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

  it('does not flag expect.poll() as a missing assertion (regression: real-world false positive found scoring web-facing code)', async () => {
    // A prior source-text-regex assertion check only matched a bare
    // `expect(` call and false-positived at error severity on files whose
    // only assertion was expect.poll()/expect.soft() — verified against a
    // real production file. That check has been removed; the AST-based
    // community playwright/expect-expect rule (already active) covers
    // this correctly on its own.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard-poll-assertion.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.score, 100, `expected 100, got ${result.score}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.findings.length, 0);
  });

  it('does not flag tests that delegate assertions to a shared assert*/verify*/expect* helper (regression: real-world false positive)', async () => {
    // expect-expect can only see expect(...) calls written directly in the
    // test body, not ones made inside a helper function the test calls —
    // a very common way to dedupe near-identical specs (e.g. a shared
    // `audit(page, path)` a11y check, or `expectXToBeVisible(page)`).
    // Verified as a real false positive against two real production files.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard-assertion-helper.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.score, 100, `expected 100, got ${result.score}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.findings.length, 0);
  });

  it('does not flag delegation to a local helper regardless of its name, only whether its body asserts (regression: name-pattern list is unbounded in practice)', async () => {
    // Real code uses unlimited naming conventions for the exact same
    // "delegates the assertion" shape (seen: audit, expectXToBeVisible,
    // alertToBeVisible, checkFlashMessageVisibility — none overlapping).
    // findLocalAssertionHelperNames discovers same-file helpers by
    // checking whether their own body contains an expect() call, so this
    // isn't a name-pattern guess at all.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard-local-assertion-helper.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.score, 100, `expected 100, got ${result.score}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.findings.length, 0);
  });

  it('still flags a test that only calls a non-asserting local helper', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-nonassert-'));
    try {
      const file = path.join(dir, 'nonassert.spec.ts');
      fs.writeFileSync(
        file,
        `import { test } from '@playwright/test';\n\nasync function goToSettings(page) {\n  await page.goto('/settings');\n}\n\ntest('does something', async ({ page }) => {\n  await goToSettings(page);\n});\n`
      );
      const result = await scorePaths({ paths: [file], profile: 'standard', cwd: dir });
      assert.ok(
        result.findings.some((f) => f.rule === 'playwright/expect-expect'),
        `expected expect-expect to still fire: ${result.findings.map((f) => f.rule).join(', ')}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag Playwright\'s documented conditional test.skip(condition, reason) (regression: real-world false positive)', async () => {
    // Verified against a real production file: eslint-plugin-playwright's
    // no-skipped-test flags this identically to an always-skipped test
    // declaration, even though playwright.dev documents this as the
    // correct way to conditionally skip a test at runtime.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard-conditional-skip.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      !result.findings.some((f) => f.rule.includes('skipped-test')),
      `expected no skip-related finding: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('still flags a real always-skipped test declaration', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-standard-blanket-skip.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-skipped-test-declaration'),
      `expected pwscore/no-skipped-test-declaration: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('drops noise from eslint-disable comments referencing rules we do not bundle (regression: real-world confusing non-finding)', async () => {
    // // eslint-disable-next-line @typescript-eslint/no-unused-vars is
    // extremely common in real TypeScript code; we only bundle the
    // @typescript-eslint parser, not its rules, so ESLint reports
    // "Definition for rule ... was not found" — a diagnostic about our own
    // rule coverage, not the spec's quality. Verified against a real file.
    const source = `import { test, expect } from '@playwright/test';\n\ntest('x', async ({\n  // eslint-disable-next-line @typescript-eslint/no-unused-vars\n  page,\n}) => {\n  expect(1).toBe(1);\n});\n`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-disable-noise-'));
    try {
      const file = path.join(dir, 'noise.spec.ts');
      fs.writeFileSync(file, source);
      const result = await scorePaths({ paths: [file], profile: 'standard', cwd: dir });
      assert.equal(
        result.findings.length,
        0,
        `expected no findings: ${JSON.stringify(result.findings)}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it('guardian does not flag variable/property names that merely contain "auth" or "timeout" as substrings (regression: false positives)', async () => {
    // authorName (contains "auth") and sessionConfig.timeout (an unrelated
    // business field, not a Playwright call option) previously tripped
    // no-hardcoded-secrets and no-generic-long-timeout respectively.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-guardian-no-secret-false-positive.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      !result.findings.some((f) => f.rule === 'guardian/no-hardcoded-secrets'),
      `expected no secret false positive: ${result.findings.map((f) => f.rule).join(', ')}`
    );
    assert.ok(
      !result.findings.some((f) => f.rule === 'guardian/no-generic-long-timeout'),
      `expected no timeout false positive: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian does not flag test.describe.serial with multiple tests as sprawl (regression: unrecognized describe form)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-guardian-serial-describe.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      !result.findings.some((f) => f.rule === 'guardian/one-describe-one-test'),
      `expected no sprawl finding on describe.serial: ${result.findings.map((f) => f.rule).join(', ')}`
    );
  });

  it('guardian require-expect recognizes test.fixme/only/skip (regression: only bare test() was recognized)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-guardian-fixme-no-expect.spec.ts')],
      profile: 'guardian',
      threshold: 75,
      cwd: root,
    });
    assert.ok(
      result.findings.some((f) => f.rule === 'guardian/require-expect'),
      `expected require-expect to fire on test.fixme: ${result.findings.map((f) => f.rule).join(', ')}`
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

  it('flags legacy page.click(selector)/page.type(selector, ...) as raw locator usage (regression: undetected classic anti-pattern)', async () => {
    // page.click('#foo') is Playwright's older direct-action API taking a
    // raw selector string — arguably the single most common raw-selector
    // anti-pattern in naive/AI-generated code. Verified as undetected by
    // both playwright/prefer-locator (mapped in profiles.ts but never
    // actually enabled — completely inert) and our own locator-ratio
    // counter (which only recognized .locator(...) and getBy*(...)): a
    // realistic sample using nothing else scored a perfect 100 on the
    // locators dimension before this fix.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-legacy-selector-actions.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      result.dimensions.locators <= 40,
      `expected low locator ratio score, got ${result.dimensions.locators}`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'playwright/prefer-locator'),
      `expected playwright/prefer-locator finding: ${result.findings.map((f) => f.rule).join(', ')}`
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

  it('directory scan excludes node_modules/dist/build/etc by default (regression: real bug scanning a project root swept in a vendored dependency spec)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-vendored-'));
    try {
      fs.mkdirSync(path.join(dir, 'e2e'));
      fs.mkdirSync(path.join(dir, 'node_modules', 'some-pkg', 'test'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
      const realSpec = `import { test, expect } from '@playwright/test';\ntest('real', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`;
      fs.writeFileSync(path.join(dir, 'e2e', 'real.spec.ts'), realSpec);
      fs.writeFileSync(
        path.join(dir, 'node_modules', 'some-pkg', 'test', 'vendored.spec.ts'),
        realSpec
      );
      fs.writeFileSync(path.join(dir, 'dist', 'built.spec.ts'), realSpec);

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.equal(
        result.summary.files,
        1,
        `expected only the real spec, got ${result.summary.files}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('directory scan skips non-Playwright test files but explicit paths are always scored (regression: mixed Jest/Vitest monorepo)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-mixed-'));
    try {
      fs.mkdirSync(path.join(dir, 'e2e'));
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(
        path.join(dir, 'e2e', 'login.spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('logs in', async ({ page }) => {\n  await page.goto('/login');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'src', 'math.test.ts'),
        `import { describe, it, expect } from 'vitest';\ndescribe('add', () => { it('works', () => { expect(1 + 1).toBe(2); }); });\n`
      );

      const dirResult = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.equal(dirResult.summary.files, 1, 'only the Playwright spec should be scored');
      assert.ok(
        dirResult.skippedFiles?.some((f) => f.includes('math.test.ts')),
        `expected math.test.ts to be reported as skipped: ${JSON.stringify(dirResult.skippedFiles)}`
      );

      const explicitResult = await scorePaths({
        paths: [path.join(dir, 'src', 'math.test.ts')],
        profile: 'standard',
        cwd: dir,
      });
      assert.equal(
        explicitResult.summary.files,
        1,
        'an explicitly-named path is always scored, even if it looks like a non-Playwright test'
      );
      assert.equal(explicitResult.skippedFiles, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it('a file with a syntax error hard-fails instead of scoring clean (regression: silent fatal-parse-error drop)', async () => {
    // ESLint reports parse errors as a message with fatal:true and
    // ruleId:null. Findings with a null ruleId were being skipped
    // entirely (that's also how the harmless "file ignored" notices are
    // filtered), so a spec that isn't even valid JS/TS previously scored
    // a perfect 100 — the worst possible failure mode for a tool whose
    // main job is catching bad (including AI-generated) code.
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-syntax-error.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.score, 0);
    assert.equal(result.grade, 'F');
    assert.equal(result.pass, false);
    assert.ok(
      result.findings.some((f) => f.rule === 'playwright-score/parse-error'),
      `expected parse-error finding: ${result.findings.map((f) => f.rule).join(', ')}`
    );
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
