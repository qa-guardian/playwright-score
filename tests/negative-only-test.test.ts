import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { defaultRow, tierOf } from '../src/catalogue/table.js';
import { testStates, UNASSERTED_RULE } from '../src/test-states.js';
import { NEGATIVE_ONLY_RULE } from '../src/rules/negative-only-test.js';
import type { Finding, ScoreResult } from '../src/types.js';

// QAG-287 N4: pwscore/negative-only-test. The fixture verdicts are checked by rule-fixtures.test.ts; this file pins
// where the finding sits, that it is report-only and never moves the score, and the shapes the fixtures do not cover.
// Expected lines are written out here, never derived from the code under test.

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'fixtures'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('package root not found');
}

const cells = path.join(packageRoot(), 'tests', 'fixtures', 'cells');
const CELL = 'pwscore__negative-only-test/-';
/** TRUE fixture -> the line of its test declaration (column 1). */
const TEST_LINE: Record<string, number> = {
  'true-not-visible.ts': 3,
  'true-js-not-visible.js': 3,
  'true-alias-not-visible.ts': 3,
  'true-count-zero.ts': 3,
  'true-js-count-zero.js': 3,
  'true-alias-count-zero.ts': 3,
  'true-hidden.ts': 3,
  'true-js-hidden.js': 3,
  'true-alias-hidden.ts': 3,
  'true-not-attached.ts': 3,
  'true-js-not-attached.js': 3,
  'true-attached-false.ts': 3,
  'true-alias-attached-false.ts': 3,
  'true-visible-false.ts': 3,
  'true-action-in-before-each.ts': 8,
};
const TITLE = 'Test that only checks that things are absent';

const runFixture = (name: string): Promise<ScoreResult> =>
  scorePaths({ paths: [path.join(cells, CELL, name)], profile: 'standard', threshold: 0, cwd: cells });
const negativesOf = (r: ScoreResult): Finding[] => r.findings.filter((f) => f.rule === NEGATIVE_ONLY_RULE);

async function run(body: string, head = `import { test, expect } from '@playwright/test';\n`): Promise<ScoreResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-neg-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.spec.ts'), `${head}${body}`);
    return await scorePaths({ paths: [path.join(dir, 'a.spec.ts')], profile: 'standard', threshold: 0, cwd: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const lines = async (body: string, head?: string): Promise<number[]> => negativesOf(await run(body, head)).map((f) => f.line!);
/** A test at line 2 of the spec: `await page.goto('/pond')`, then `rest`. */
const t = (rest: string): string => `test('pond', async ({ page }) => {\n  await page.goto('/pond');\n${rest}});\n`;
const HIDDEN = `  await expect(page.getByRole('alert')).toBeHidden();\n`;

describe('QAG-287 N4: pwscore/negative-only-test', () => {
  it('the fixture table lists every TRUE fixture on disk', () => {
    const onDisk = fs.readdirSync(path.join(cells, CELL)).filter((n) => n.startsWith('true-')).sort();
    assert.deepEqual(onDisk, Object.keys(TEST_LINE).sort());
  });

  for (const [name, line] of Object.entries(TEST_LINE)) {
    it(`${name}: one report-only, likely finding at the test, and the rest of the result is the same with the step off`, async () => {
      const on = await runFixture(name);
      const hits = negativesOf(on);
      assert.equal(hits.length, 1, JSON.stringify(hits));
      const [f] = hits;
      assert.deepEqual([f.line, f.column, f.scope, f.reportOnly, f.severity, f.tier, f.dimension, f.form], [line, 1, 'test', true, 'info', 'likely', 'assertions', '-']);
      assert.equal(f.testKey, `${f.file}#0`);
      assert.equal(f.title, TITLE);
      assert.match(f.message, /would still pass if the page were blank or had not rendered the result/);
      assert.doesNotMatch(f.message, /error page/);
      assert.deepEqual(
        (on.testStates ?? []).map((s) => s.state),
        ['clean']
      );
      testStates.enabled = false;
      let off: ScoreResult;
      try {
        off = await runFixture(name);
      } finally {
        testStates.enabled = true;
      }
      assert.equal(negativesOf(off).length, 0);
      assert.deepEqual(on.dimensions, off.dimensions, 'dimensions');
      for (const s of on.testStates ?? []) assert.ok(!(s.chargedBy ?? []).some((r) => r.rule === NEGATIVE_ONLY_RULE), `${s.file}:${s.line} is charged`);
      const rest = (r: ScoreResult) => JSON.stringify(r.findings.filter((x) => x.rule !== NEGATIVE_ONLY_RULE && x.rule !== UNASSERTED_RULE));
      assert.equal(rest(on), rest(off));
    });
  }

  it('the score, grade and gate do not move: the same suite with and without an absence-only test', async () => {
    const extra = `test('more', async ({ page }) => {\n  await page.goto('/pond');\n  await expect(page.getByRole('heading')).toHaveText('Pond');\n});\n`;
    const r = await run(`${extra}${t(HIDDEN)}`);
    assert.deepEqual(negativesOf(r).map((f) => f.line), [6]);
    assert.deepEqual([r.score, r.summary.countedTests, r.summary.chargedTests, r.pass, r.gate?.reasons], [100, 2, 0, true, []]);
  });

  it('the matcher list: six absence forms count, every other polarity or option does not', async () => {
    const one = (m: string) => lines(t(`  await expect(page.getByRole('alert'))${m};\n`));
    for (const m of ['.not.toBeVisible()', '.toBeHidden()', '.toBeVisible({ visible: false })', '.not.toBeAttached()', '.toBeAttached({ attached: false })', '.toHaveCount(0)', '.toHaveCount(0, { timeout: 2000 })', '.not.toBeVisible({ timeout: 2000 })']) {
      assert.deepEqual(await one(m), [2], m);
    }
    for (const m of ['.toBeVisible()', '.not.toBeHidden()', '.toBeVisible({ visible: true })', '.not.toBeVisible({ visible: false })', '.toBeAttached()', '.not.toBeAttached({ attached: false })', '.not.toHaveCount(0)', '.toHaveCount(1)', '.not.toHaveText(\'Leak\')', '.not.toContainText(\'Leak\')', '.toBeVisible({ visible: shown })']) {
      assert.deepEqual(await one(m), [], m);
    }
    // only the literal 0 is the empty count
    assert.deepEqual(await lines(t(`  const none = 0;\n  await expect(page.getByRole('row')).toHaveCount(none);\n`)), []);
  });

  it('expect.soft and expect.configure count like expect; expect.poll and a generic matcher are other assertions', async () => {
    assert.deepEqual(await lines(t(`  await expect.soft(page.getByRole('alert')).not.toBeVisible();\n`)), [2]);
    assert.deepEqual(await lines(t(`  await expect.configure({ timeout: 9000 })(page.getByRole('alert')).toBeHidden();\n`)), [2]);
    assert.deepEqual(await lines(t(`${HIDDEN}  await expect.poll(async () => page.getByRole('alert').count()).toBe(0);\n`)), []);
    assert.deepEqual(await lines(t(`${HIDDEN}  expect(await page.title()).toBe('Pond');\n`)), []);
  });

  it('a wait for the page anywhere in the test or its hooks: no finding', async () => {
    for (const w of [`page.waitForURL('**/pond')`, `page.waitForResponse('**/api/pond')`, `page.waitForSelector('.pond')`, `page.getByRole('main').waitFor()`]) {
      assert.deepEqual(await lines(t(`${HIDDEN}  await ${w};\n`)), [], w);
    }
    const hook = `test.afterEach(async ({ page }) => {\n  await page.waitForURL('**/pond');\n});\n`;
    assert.deepEqual(await lines(`${hook}${t(HIDDEN)}`), []);
  });

  it('run order is beforeAll, beforeEach, the test, afterEach, afterAll', async () => {
    // the action in a beforeEach comes before an absence check in the test, or in an afterEach
    const before = `test.beforeEach(async ({ page }) => {\n  await page.goto('/pond');\n});\n`;
    assert.deepEqual(await lines(`${before}test('pond', async ({ page }) => {\n${HIDDEN}});\n`), [5]);
    const after = `test.afterEach(async ({ page }) => {\n${HIDDEN}});\n`;
    assert.deepEqual(await lines(`${after}${t('')}`), [5]);
    // an absence check in a beforeAll runs before the action in a beforeEach
    const all = `test.beforeAll(async ({ browser }) => {\n  const p = await browser.newPage();\n  await expect(p.getByRole('alert')).toBeHidden();\n});\n`;
    assert.deepEqual(await lines(`${all}${before}test('pond', async ({ page }) => {\n${HIDDEN}});\n`), []);
    // a hook out of scope (another describe) does not count
    const other = `test.describe('other', () => {\n  test.afterEach(async ({ page }) => {\n    await expect(page).toHaveURL(/pond/);\n  });\n});\n`;
    assert.deepEqual(await lines(`${other}${t(HIDDEN)}`), [7]);
  });

  it('a helper the states resolve is followed: its action, wait or positive check counts at the call', async () => {
    const helper = (inner: string) => `async function openPond(page) {\n${inner}}\n`;
    const test2 = (pre: string) => `test('pond', async ({ page }) => {\n${pre}${HIDDEN}});\n`;
    assert.deepEqual(await lines(`${helper(`  await page.goto('/pond');\n`)}${test2(`  await openPond(page);\n`)}`), [5]);
    assert.deepEqual(await lines(`${helper(`  await page.goto('/pond');\n  await page.waitForURL('**/pond');\n`)}${test2(`  await openPond(page);\n`)}`), []);
    assert.deepEqual(await lines(`${helper(`  await page.goto('/pond');\n  await expect(page.getByRole('main')).toBeVisible();\n`)}${test2(`  await openPond(page);\n`)}`), []);
    // a helper with only an absence check, called after the action
    const check = `async function noAlert(page) {\n  await expect(page.getByRole('alert')).not.toBeVisible();\n}\n`;
    assert.deepEqual(await lines(`${check}${t(`  await noAlert(page);\n`)}`), [5]);
  });

  it('no action before the first absence check, an unresolved call, or no assertion: no finding', async () => {
    assert.deepEqual(await lines(`test('pond', async ({ page }) => {\n${HIDDEN}  await page.goto('/pond');\n});\n`), []);
    const imp = `import { test, expect } from '@playwright/test';\nimport { checkPond } from 'acme-pond-checks';\n`;
    assert.deepEqual(await lines(t(`  await checkPond(page);\n${HIDDEN}`), imp), []);
    assert.deepEqual(await lines(t(`  await page.getByRole('button').click();\n`)), []);
    assert.deepEqual(await lines(`test.skip('pond', async ({ page }) => {\n  await page.goto('/pond');\n${HIDDEN}});\n`), []);
    // a guarded throw is an assertion of the states, and not an absence check
    assert.deepEqual(await lines(t(`${HIDDEN}  if (await page.getByRole('main').count() > 1) throw new Error('two mains');\n`)), []);
  });

  it('one finding per test when a hook holds the only check', async () => {
    const after = `test.afterEach(async ({ page }) => {\n${HIDDEN}});\n`;
    const two = `test('a', async ({ page }) => {\n  await page.goto('/pond');\n});\ntest('b', async ({ page }) => {\n  await page.goto('/lake');\n});\n`;
    const hits = negativesOf(await run(`${after}${two}`));
    assert.deepEqual(hits.map((f) => [f.line, f.column, f.scope]), [[5, 1, 'test'], [8, 1, 'test']]);
  });

  it('the catalogue cell is report-only, likely and cites the toBeHidden docs', () => {
    const row = defaultRow(NEGATIVE_ONLY_RULE);
    assert.ok(row);
    assert.deepEqual([row!.form, row!.family, row!.design, row!.basis, row!.bcEligible, row!.reportOnly, row!.dimension], ['-', 'passes-regardless', 'likely', 'docs', false, true, 'assertions']);
    assert.equal(row!.docs, 'https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-be-hidden');
    assert.equal(tierOf(row!), 'likely');
    assert.doesNotMatch(`${row!.what} ${row!.why} ${row!.fix}`, /error page/);
  });
});
