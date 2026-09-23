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

/** Writes `source` to a throwaway temp spec and scores just that file. */
async function scoreSource(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-src-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, source);
    return await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('scorePaths integration', () => {
  it('scores good-standard highly', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.equal(result.scoreVersion, 'v4');
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

  it('catches all four QAG-196 gameability tricks as real, scored findings under standard (model v4 — owner direction: public scores reflect quality, not a report-only compromise)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-gameable.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    const GAMEABILITY_RULES = [
      'pwscore/no-timer-sleep',
      'pwscore/no-coordinate-click',
      'pwscore/no-trivial-assertion',
      'pwscore/no-soft-assertion-only-test',
    ];
    const rules = result.findings.map((f) => f.rule);
    for (const expected of GAMEABILITY_RULES) {
      assert.ok(rules.includes(expected), `expected ${expected}, got: ${rules.join(', ')}`);
    }
    // v4: none of the four is report-only any more — every one is a real
    // demerit under the one remaining public profile (`standard`). See
    // profiles.ts and CHANGELOG.md's 2.0.0 entry.
    for (const rule of GAMEABILITY_RULES) {
      const finding = result.findings.find((f) => f.rule === rule);
      assert.ok(!finding?.reportOnly, `expected ${rule} to be a scored (non-reportOnly) finding`);
    }
    assert.ok(
      result.score < 100,
      `expected a real score hit from all four gameability tricks, got ${result.score}`
    );
  });

  it('the fixed equivalents (real waits, locator clicks, real assertions, mixed hard+soft) score clean', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard-no-gameable.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      !result.findings.some((f) =>
        [
          'pwscore/no-timer-sleep',
          'pwscore/no-coordinate-click',
          'pwscore/no-trivial-assertion',
          'pwscore/no-soft-assertion-only-test',
        ].includes(f.rule)
      ),
      `expected none of the gameability rules to fire, got: ${result.findings.map((f) => f.rule).join(', ')}`
    );
    assert.equal(result.score, 100);
  });

  it('no-coordinate-click is a warning-level (partial) demerit, not error-level, to soften the canvas-app false positive', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('coordinate click', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await page.mouse.click(120, 240);\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    const finding = result.findings.find((f) => f.rule === 'pwscore/no-coordinate-click');
    assert.equal(finding?.severity, 'warning', `expected a warning, not an error: ${JSON.stringify(finding)}`);
    // A single warning-level finding costs 0.4 of one test's demerit
    // budget in one dimension: 1 test, 0.4/1 -> 60. A full error-level
    // demerit would have zeroed the dimension instead (0/1 -> 0).
    assert.equal(result.dimensions.playwrightHygiene, 60, JSON.stringify(result.dimensions));
  });

  it("standard-profile scores of the local fixture corpus reflect v4's scored gameability rules (regression guard — locks in the exact numbers so an accidental rule/severity change is caught)", async () => {
    const EXPECTED_STANDARD_SCORES: Record<string, number> = {
      'bad-conditional-logic.spec.ts': 73,
      'bad-gameable.spec.ts': 77,
      'bad-legacy-selector-actions.spec.ts': 87,
      'bad-no-expects.spec.ts': 75,
      'bad-raw-locators.spec.ts': 67,
      'bad-standard-blanket-skip.spec.ts': 94,
      'bad-syntax-error.spec.ts': 0, // hard-fail (parse error), not a real score
      'bad-waits.spec.ts': 40,
      'good-standard-assertion-helper.spec.ts': 100,
      'good-standard-conditional-skip.spec.ts': 100,
      'good-standard-local-assertion-helper.spec.ts': 100,
      'good-standard-no-gameable.spec.ts': 100,
      'good-standard-poll-assertion.spec.ts': 100,
      'good-standard.spec.ts': 100,
    };

    for (const [name, expectedScore] of Object.entries(EXPECTED_STANDARD_SCORES)) {
      const result = await scorePaths({
        paths: [path.join(fixtures, name)],
        profile: 'standard',
        threshold: 0,
        cwd: root,
      });
      assert.equal(
        result.score,
        expectedScore,
        `${name}: expected standard score ${expectedScore}, got ${result.score}: ${JSON.stringify(result.findings)}`
      );
    }
  });

  it('a legacy "strict" profile string degrades gracefully to standard weights via the library API (same fallback as the removed "guardian" profile)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard.spec.ts')],
      profile: 'strict' as never,
      threshold: 80,
      cwd: root,
    });
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.deepEqual(Object.keys(result.dimensions).sort(), [
      'assertions',
      'locators',
      'playwrightHygiene',
      'structure',
    ]);
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

  it('drops the "Definition for rule ... was not found" ESLint noise for a rule we do not bundle, but still reports the suppression comment itself (regression: real-world confusing non-finding; behavior change: pre-2.0.0 review — suppression comments are no longer invisible)', async () => {
    // // eslint-disable-next-line @typescript-eslint/no-unused-vars is
    // extremely common in real TypeScript code; we only bundle the
    // @typescript-eslint parser, not its rules, so ESLint reports
    // "Definition for rule ... was not found" — a diagnostic about our own
    // rule coverage, not the spec's quality, and still dropped. What's new
    // as of 2.0.0: the suppression comment itself is now a real, scored
    // pwscore/eslint-disable-comment finding under standard — see
    // metrics.ts's findEslintDisableComments and VALIDATION.md.
    const source = `import { test, expect } from '@playwright/test';\n\ntest('x', async ({\n  // eslint-disable-next-line @typescript-eslint/no-unused-vars\n  page,\n}) => {\n  expect(page).toBeDefined();\n});\n`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-disable-noise-'));
    try {
      const file = path.join(dir, 'noise.spec.ts');
      fs.writeFileSync(file, source);
      const result = await scorePaths({ paths: [file], profile: 'standard', cwd: dir });
      assert.deepEqual(
        result.findings.map((f) => f.rule),
        ['pwscore/eslint-disable-comment'],
        `expected only the suppression-comment finding, no rule-coverage noise: ${JSON.stringify(result.findings)}`
      );
      assert.ok(!result.findings[0].reportOnly);
      assert.ok(result.score < 100, 'a scored (non-reportOnly) finding must cost points under standard');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to standard weights for an unrecognized profile string instead of throwing (regression: removing the guardian profile must degrade gracefully for any caller still pinned to it)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard.spec.ts')],
      profile: 'guardian' as never,
      threshold: 80,
      cwd: root,
    });
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.deepEqual(Object.keys(result.dimensions).sort(), [
      'assertions',
      'locators',
      'playwrightHygiene',
      'structure',
    ]);
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

  it('directory scan discovers *.e2e.ts specs and still excludes a Cypress *.e2e.ts sitting alongside them (regression: cal.com — 53 real Playwright specs named *.e2e.ts, zero *.spec.ts/*.test.ts, previously hard-failed as "no files matched")', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-e2e-glob-'));
    try {
      fs.mkdirSync(path.join(dir, 'playwright'));
      fs.mkdirSync(path.join(dir, 'cypress'));
      fs.writeFileSync(
        path.join(dir, 'playwright', 'login.e2e.ts'),
        `import { test, expect } from '@playwright/test';\ntest('logs in', async ({ page }) => {\n  await page.goto('/login');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'cypress', 'checkout.e2e.ts'),
        `describe('checkout', () => {\n  it('completes a purchase', () => {\n    cy.visit('/cart');\n    cy.get('[data-testid=checkout]').click();\n  });\n});\n`
      );

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.equal(result.summary.files, 1, 'only the real Playwright *.e2e.ts should be scored');
      assert.ok(
        result.skippedFiles?.some((f) => f.includes('checkout.e2e.ts')),
        `expected the Cypress *.e2e.ts to be reported as skipped: ${JSON.stringify(result.skippedFiles)}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('directory scan discovers *.e2e-spec.ts specs and still excludes a vitest *.e2e-spec.ts using the same suffix (regression: Immich — 13 real Playwright specs named *.e2e-spec.ts alongside 31 vitest/supertest backend specs using the identical suffix)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-e2e-spec-glob-'));
    try {
      fs.mkdirSync(path.join(dir, 'web'));
      fs.mkdirSync(path.join(dir, 'server'));
      fs.writeFileSync(
        path.join(dir, 'web', 'album.e2e-spec.ts'),
        `import { test, expect } from '@playwright/test';\ntest('creates an album', async ({ page }) => {\n  await page.goto('/albums');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'server', 'download.e2e-spec.ts'),
        `import { describe, it, expect } from 'vitest';\nimport request from 'supertest';\ndescribe('/download', () => {\n  it('downloads an asset', () => { expect(1).toBe(1); });\n});\n`
      );

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.equal(result.summary.files, 1, 'only the real Playwright *.e2e-spec.ts should be scored');
      assert.ok(
        result.skippedFiles?.some((f) => f.includes('download.e2e-spec.ts')),
        `expected the vitest *.e2e-spec.ts to be reported as skipped: ${JSON.stringify(result.skippedFiles)}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('directory scan discovers *.pw.ts specs (regression: Flagsmith — 20 real Playwright specs named *.pw.ts, zero *.spec.ts/*.test.ts, previously hard-failed as "no files matched")', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-pw-glob-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'flag-tests.pw.ts'),
        `import { test, expect } from '@playwright/test';\ntest('creates a flag', async ({ page }) => {\n  await page.goto('/flags');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n`
      );

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.equal(result.summary.files, 1, 'the *.pw.ts spec should be scored');
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

  it('directory scan traces locators through an imported Page Object Model (regression: n8n-style suite scored 0/100 on locators despite using native locators throughout)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-pom-'));
    try {
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
      // The spec itself calls zero page/locator methods directly — every
      // interaction and assertion is delegated to an imported page object,
      // the same shape as a real Page Object Model suite.
      fs.writeFileSync(
        path.join(dir, 'tests', 'canvas.spec.ts'),
        `import { test } from '@playwright/test';\n` +
          `import { CanvasPage } from '../pages/CanvasPage';\n` +
          `test('adds a node', async ({ page }) => {\n` +
          `  const canvas = new CanvasPage(page);\n` +
          `  await canvas.addNode('HTTP Request');\n` +
          `  await canvas.expectNodeVisible('HTTP Request');\n` +
          `});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'pages', 'CanvasPage.ts'),
        `import { expect, type Page } from '@playwright/test';\n` +
          `export class CanvasPage {\n` +
          `  constructor(private page: Page) {}\n` +
          `  async addNode(name: string) {\n` +
          `    await this.page.getByRole('button', { name: 'Add node' }).click();\n` +
          `    await this.page.getByTestId('node-creator-item').getByText(name).click();\n` +
          `  }\n` +
          `  async expectNodeVisible(name: string) {\n` +
          `    await expect(this.page.getByTestId('canvas-node').getByText(name)).toBeVisible();\n` +
          `  }\n` +
          `}\n`
      );

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });

      assert.equal(result.summary.files, 1, 'only the spec file counts as a scored file');
      assert.equal(result.summary.sloc, 7, 'the page object must not inflate suite SLOC');
      assert.ok(
        result.summary.nativeLocators >= 3,
        `expected CanvasPage.ts's getByRole/getByTestId calls to be counted: got ${result.summary.nativeLocators}`
      );
      assert.equal(
        result.dimensions.locators,
        100,
        `expected a clean locators score once the page object's native locators are counted, got ${result.dimensions.locators}`
      );
      assert.ok(
        !result.findings.some((f) => f.file.includes('CanvasPage')),
        `the page object must never appear in findings (it is not a scored test file): ${JSON.stringify(result.findings)}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('traces assertion delegation through an imported helper the same way as a same-file helper', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-pom-assert-'));
    try {
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'helpers'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'tests', 'login.spec.ts'),
        `import { test } from '@playwright/test';\n` +
          `import { verifyLoggedIn } from '../helpers/assertions';\n` +
          `test('logs in', async ({ page }) => {\n` +
          `  await page.goto('/login');\n` +
          `  await verifyLoggedIn(page);\n` +
          `});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'helpers', 'assertions.ts'),
        `import { expect, type Page } from '@playwright/test';\n` +
          `export async function verifyLoggedIn(page: Page) {\n` +
          `  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();\n` +
          `}\n`
      );

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.ok(
        !result.findings.some((f) => f.rule === 'playwright/expect-expect'),
        `expected the delegated assertion to be recognized: ${JSON.stringify(result.findings)}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('traces a two-level Page Object Model assertion delegated through an imported class (regression: n8n NotificationsPage.waitForNotificationAndClose)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-pom-two-level-'));
    try {
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
      // The spec calls a class method two levels removed from any expect()
      // call — waitForNotificationAndClose calls this.waitForNotification,
      // which calls .waitFor(). Neither the spec nor the immediate method
      // it calls contains expect() or waitFor() directly.
      fs.writeFileSync(
        path.join(dir, 'tests', 'pdf-embed.spec.ts'),
        `import { test } from '@playwright/test';\n` +
          `import { NotificationsPage } from '../pages/NotificationsPage';\n` +
          `test('embeds a pdf', async ({ page }) => {\n` +
          `  const notifications = new NotificationsPage(page);\n` +
          `  await page.goto('/import');\n` +
          `  await notifications.waitForNotificationAndClose('Node executed successfully');\n` +
          `});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'pages', 'NotificationsPage.ts'),
        `import type { Page } from '@playwright/test';\n` +
          `export class NotificationsPage {\n` +
          `  constructor(private page: Page) {}\n` +
          `  async waitForNotification(text: string) {\n` +
          `    await this.page.getByRole('alert').getByText(text).first().waitFor({ state: 'visible' });\n` +
          `  }\n` +
          `  async waitForNotificationAndClose(text: string) {\n` +
          `    await this.waitForNotification(text);\n` +
          `    await this.page.getByRole('button', { name: 'Close' }).click();\n` +
          `  }\n` +
          `}\n`
      );

      const result = await scorePaths({ paths: [dir], profile: 'standard', cwd: dir });
      assert.ok(
        !result.findings.some((f) => f.rule === 'playwright/expect-expect'),
        `expected the two-level delegated assertion to be recognized: ${JSON.stringify(result.findings)}`
      );
      assert.ok(
        !result.findings.some((f) => f.file.includes('NotificationsPage')),
        'the page object must never appear in findings (it is not a scored test file)'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('explicit single-file scoring stays bounded to that file (does not widen to sibling directories)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-pom-explicit-'));
    try {
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
      const specFile = path.join(dir, 'tests', 'canvas.spec.ts');
      fs.writeFileSync(
        specFile,
        `import { test } from '@playwright/test';\n` +
          `import { CanvasPage } from '../pages/CanvasPage';\n` +
          `test('adds a node', async ({ page }) => {\n` +
          `  const canvas = new CanvasPage(page);\n` +
          `  await canvas.addNode('X');\n` +
          `});\n`
      );
      fs.writeFileSync(
        path.join(dir, 'pages', 'CanvasPage.ts'),
        `import type { Page } from '@playwright/test';\n` +
          `export class CanvasPage {\n` +
          `  constructor(private page: Page) {}\n` +
          `  async addNode(name: string) {\n` +
          `    await this.page.getByRole('button', { name }).click();\n` +
          `  }\n` +
          `}\n`
      );

      // Only the spec file is passed explicitly — no directory input to
      // widen the import-tracing boundary to, so the sibling pages/
      // directory is never reached. Documents the current, deliberate
      // limitation rather than letting it silently drift either way.
      const result = await scorePaths({ paths: [specFile], profile: 'standard', cwd: dir });
      assert.equal(result.summary.nativeLocators, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags conditional logic, element handles, and page.pause in tests (regression: <=0.2.0 dropped the whole rule group)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'bad-conditional-logic.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    const rules = result.findings.map((f) => f.rule);
    // <=0.2.0 spread eslint-plugin-playwright's flat/recommended only when
    // it was an array; the plugin exports a single config object, so none
    // of these ever fired and this fixture scored a clean 100.
    assert.ok(rules.includes('playwright/no-conditional-in-test'), `expected no-conditional-in-test, got: ${rules.join(', ')}`);
    assert.ok(rules.includes('playwright/no-conditional-expect'), `expected no-conditional-expect, got: ${rules.join(', ')}`);
    assert.ok(rules.includes('playwright/no-element-handle'), `expected no-element-handle, got: ${rules.join(', ')}`);
    assert.ok(rules.includes('playwright/no-page-pause'), `expected no-page-pause, got: ${rules.join(', ')}`);
    // All of these are hygiene findings and must actually move the score.
    assert.ok(result.dimensions.playwrightHygiene < 100, `hygiene should drop below 100, got ${result.dimensions.playwrightHygiene}`);
    assert.ok(result.score < 100, `score should drop below 100, got ${result.score}`);
  });

  it('conditional runtime skip stays clean (test.skip(condition, reason) is idiomatic, not conditional logic)', async () => {
    const result = await scorePaths({
      paths: [path.join(fixtures, 'good-standard-conditional-skip.spec.ts')],
      profile: 'standard',
      threshold: 80,
      cwd: root,
    });
    assert.ok(
      !result.findings.some((f) => f.rule === 'playwright/no-conditional-in-test'),
      `conditional skip must not be flagged as conditional-in-test: ${result.findings.map((f) => f.rule).join(', ')}`
    );
    assert.equal(result.pass, true);
  });
});

describe('pre-1.1.0 review fixes: no-trivial-assertion is matcher-aware, not just literal-subject-aware', () => {
  it('does not flag the deliberate force-fail idiom expect(true).toBe(false) (always fails, not always passes)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('force fails', async () => {\n` +
        `  expect(true).toBe(false);\n` +
        `});\n`
    );
    assert.ok(
      !result.findings.some((f) => f.rule === 'pwscore/no-trivial-assertion'),
      `expected no-trivial-assertion not to fire on a force-fail assertion: ${JSON.stringify(result.findings)}`
    );
  });

  it('does not flag expect(true, msg).toBeFalsy() (a message argument does not change the subject; toBeFalsy on true always fails)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('force fails with a message', async () => {\n` +
        `  expect(true, 'unreachable').toBeFalsy();\n` +
        `});\n`
    );
    assert.ok(
      !result.findings.some((f) => f.rule === 'pwscore/no-trivial-assertion'),
      `expected no-trivial-assertion not to fire on expect(true, msg).toBeFalsy(): ${JSON.stringify(result.findings)}`
    );
  });

  it('does not flag expect(x).not.toBe(true) style negation when the negated assertion always fails', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('negated force-fail', async () => {\n` +
        `  expect(true).not.toBe(true);\n` +
        `});\n`
    );
    assert.ok(
      !result.findings.some((f) => f.rule === 'pwscore/no-trivial-assertion'),
      `expected no-trivial-assertion not to fire when .not flips an always-true match to always-false: ${JSON.stringify(result.findings)}`
    );
  });

  it('the finding message is accurate: only ever claims "always passes", never fires on an assertion that always fails', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('trivially true', async () => {\n` +
        `  expect(true).toBe(true);\n` +
        `});\n`
    );
    const finding = result.findings.find((f) => f.rule === 'pwscore/no-trivial-assertion');
    assert.ok(finding, `expected no-trivial-assertion to fire on expect(true).toBe(true): ${JSON.stringify(result.findings)}`);
    assert.match(finding!.message, /always passes/i);
  });

  it('flags expect([]).toEqual([]) (empty-array respelling of a trivial assertion)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('trivial array equality', async () => {\n` +
        `  expect([]).toEqual([]);\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-trivial-assertion'),
      `expected no-trivial-assertion to fire on expect([]).toEqual([]): ${JSON.stringify(result.findings)}`
    );
  });

  it('flags a template-literal respelling of a trivial assertion', async () => {
    const result = await scoreSource(
      'import { test, expect } from \'@playwright/test\';\n' +
        'test(\'trivial template literal\', async () => {\n' +
        '  expect(`hello`).toBe(`hello`);\n' +
        '});\n'
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-trivial-assertion'),
      `expected no-trivial-assertion to fire on a template-literal subject: ${JSON.stringify(result.findings)}`
    );
  });

  it('flags a constant-expression respelling of a trivial assertion (1 + 1)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('trivial arithmetic', async () => {\n` +
        `  expect(1 + 1).toBe(2);\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-trivial-assertion'),
      `expected no-trivial-assertion to fire on expect(1 + 1).toBe(2): ${JSON.stringify(result.findings)}`
    );
  });
});

describe('pre-1.1.0 review fixes: no-timer-sleep respellings', () => {
  it('flags setTimeout(() => r(), ms) — a no-op wrapper around the resolve callback', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('wrapped resolve sleep', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await new Promise((r) => setTimeout(() => r(), 500));\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-timer-sleep'),
      `expected no-timer-sleep to fire on setTimeout(() => r(), ms): ${JSON.stringify(result.findings)}`
    );
  });

  it('flags globalThis.setTimeout(resolve, ms)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('globalThis sleep', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await new Promise((resolve) => globalThis.setTimeout(resolve, 500));\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-timer-sleep'),
      `expected no-timer-sleep to fire on globalThis.setTimeout(resolve, ms): ${JSON.stringify(result.findings)}`
    );
  });

  it('flags a bare, imported node:timers/promises setTimeout(ms) sleep', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `import { setTimeout as sleep } from 'node:timers/promises';\n` +
        `test('timers/promises sleep', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await sleep(500);\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-timer-sleep'),
      `expected no-timer-sleep to fire on an imported node:timers/promises setTimeout(ms): ${JSON.stringify(result.findings)}`
    );
  });

  it('does not flag an unrelated setTimeout import from another module', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `import { setTimeout as sleep } from 'some-other-timers-lib';\n` +
        `test('unrelated import', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await sleep(500);\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      !result.findings.some((f) => f.rule === 'pwscore/no-timer-sleep'),
      `expected no-timer-sleep not to fire on a same-named import from an unrelated module: ${JSON.stringify(result.findings)}`
    );
  });
});

describe('pre-1.1.0 review fixes: no-coordinate-click respellings', () => {
  it('flags a destructured mouse binding (const { mouse } = page; mouse.click(...))', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('destructured mouse click', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  const { mouse } = page;\n` +
        `  await mouse.click(120, 240);\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-coordinate-click'),
      `expected no-coordinate-click to fire on a destructured mouse.click: ${JSON.stringify(result.findings)}`
    );
  });

  it('flags page.mouse.dblclick(x, y)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('coordinate double click', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await page.mouse.dblclick(120, 240);\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      result.findings.some((f) => f.rule === 'pwscore/no-coordinate-click'),
      `expected no-coordinate-click to fire on page.mouse.dblclick: ${JSON.stringify(result.findings)}`
    );
  });

  it('flags a manual move+down+up sequence at fixed coordinates', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('manual click via move/down/up', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await page.mouse.move(120, 240);\n` +
        `  await page.mouse.down();\n` +
        `  await page.mouse.up();\n` +
        `  await expect(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    const hits = result.findings.filter((f) => f.rule === 'pwscore/no-coordinate-click');
    assert.equal(
      hits.length,
      3,
      `expected move+down+up to each trip no-coordinate-click, got: ${JSON.stringify(result.findings)}`
    );
  });
});

describe('pre-1.1.0 review fixes: no-soft-assertion-only-test counts expect.poll as a hard assertion', () => {
  it('does not flag a test whose only assertion is expect.poll(...) (a failed poll still throws)', async () => {
    const result = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('polls for a condition', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await expect.poll(async () => page.title()).toBe('Ready');\n` +
        `});\n`
    );
    assert.ok(
      !result.findings.some((f) => f.rule === 'pwscore/no-soft-assertion-only-test'),
      `expected expect.poll to count as a hard assertion: ${JSON.stringify(result.findings)}`
    );
  });

  it('still flags a test mixing expect.soft(...) with expect.poll(...) as nothing (poll is hard) but flags soft-with-no-hard-and-no-poll', async () => {
    const mixed = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('soft plus poll', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await expect.soft(page.getByRole('heading')).toBeVisible();\n` +
        `  await expect.poll(async () => page.title()).toBe('Ready');\n` +
        `});\n`
    );
    assert.ok(
      !mixed.findings.some((f) => f.rule === 'pwscore/no-soft-assertion-only-test'),
      `expected soft+poll not to be flagged as soft-only: ${JSON.stringify(mixed.findings)}`
    );

    const softOnly = await scoreSource(
      `import { test, expect } from '@playwright/test';\n` +
        `test('soft only, no poll', async ({ page }) => {\n` +
        `  await page.goto('/app');\n` +
        `  await expect.soft(page.getByRole('heading')).toBeVisible();\n` +
        `});\n`
    );
    assert.ok(
      softOnly.findings.some((f) => f.rule === 'pwscore/no-soft-assertion-only-test'),
      `expected soft-only (no poll) to still be flagged: ${JSON.stringify(softOnly.findings)}`
    );
  });
});

describe('pre-2.0.0 review fixes: inline eslint-disable comments are reported, not invisible', () => {
  const SOURCE =
    `import { test, expect } from '@playwright/test';\n` +
    `test('suppresses a real finding', async ({ page }) => {\n` +
    `  await page.goto('/app');\n` +
    `  // eslint-disable-next-line pwscore/no-coordinate-click\n` +
    `  await page.mouse.click(120, 240);\n` +
    `  await expect(page.getByRole('heading')).toBeVisible();\n` +
    `});\n`;

  it('is a real, scored demerit under standard (model v4 — not report-only)', async () => {
    const result = await scoreSource(SOURCE);
    const finding = result.findings.find((f) => f.rule === 'pwscore/eslint-disable-comment');
    assert.ok(finding, `expected pwscore/eslint-disable-comment: ${JSON.stringify(result.findings)}`);
    assert.ok(!finding!.reportOnly);
  });

  it('fires once per suppression comment, counting block and line-disable forms alike', async () => {
    const source =
      `import { test, expect } from '@playwright/test';\n` +
      `/* eslint-disable playwright/no-wait-for-timeout */\n` +
      `test('two suppressions', async ({ page }) => {\n` +
      `  await page.goto('/app');\n` +
      `  await page.waitForTimeout(1000); // eslint-disable-line playwright/no-wait-for-timeout\n` +
      `  await expect(page.getByRole('heading')).toBeVisible();\n` +
      `});\n`;
    const result = await scoreSource(source);
    const hits = result.findings.filter((f) => f.rule === 'pwscore/eslint-disable-comment');
    assert.equal(hits.length, 2, `expected two suppression-comment findings: ${JSON.stringify(result.findings)}`);
  });
});
