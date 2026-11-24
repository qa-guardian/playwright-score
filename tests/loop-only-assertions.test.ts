import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePaths } from '../src/index.js';
import { defaultRow, tierOf } from '../src/catalogue/table.js';
import { testStates, UNASSERTED_RULE } from '../src/test-states.js';
import { LOOP_RULE } from '../src/rules/loop-only-assertions.js';
import type { Finding, ScoreResult } from '../src/types.js';

// QAG-287 N3: pwscore/loop-only-assertions. The fixture verdicts are checked by rule-fixtures.test.ts; this file pins
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
const CELL = 'pwscore__loop-only-assertions/-';
/** TRUE fixture -> the line of the loop it must be reported at (column 3: every loop is indented two spaces). */
const LOOP_LINE: Record<string, number> = {
  'true-all-loop.ts': 5,
  'true-js-all-loop.js': 5,
  'true-alias-all-loop.ts': 7,
  'true-count-range.ts': 7,
  'true-js-count-range.js': 7,
  'true-alias-count-range.ts': 6,
  'true-dollar-loop.ts': 5,
  'true-js-dollar-loop.js': 5,
  'true-alias-dollar-loop.ts': 7,
};

const runFixture = (name: string): Promise<ScoreResult> =>
  scorePaths({ paths: [path.join(cells, CELL, name)], profile: 'standard', threshold: 0, cwd: cells });
const loopsOf = (r: ScoreResult): Finding[] => r.findings.filter((f) => f.rule === LOOP_RULE);

async function run(body: string): Promise<ScoreResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-loop-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.spec.ts'), `import { test, expect } from '@playwright/test';\n${body}`);
    return await scorePaths({ paths: [path.join(dir, 'a.spec.ts')], profile: 'standard', threshold: 0, cwd: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const lines = async (body: string): Promise<number[]> => loopsOf(await run(body)).map((f) => f.line!);

describe('QAG-287 N3: pwscore/loop-only-assertions', () => {
  it('the fixture table lists every TRUE fixture on disk', () => {
    const onDisk = fs.readdirSync(path.join(cells, CELL)).filter((n) => n.startsWith('true-')).sort();
    assert.deepEqual(onDisk, Object.keys(LOOP_LINE).sort());
  });

  for (const [name, line] of Object.entries(LOOP_LINE)) {
    it(`${name}: one report-only, likely finding at the loop, and the score is the same with the step off`, async () => {
      const on = await runFixture(name);
      const hits = loopsOf(on);
      assert.equal(hits.length, 1, JSON.stringify(hits));
      const [f] = hits;
      assert.deepEqual([f.line, f.column, f.scope, f.reportOnly, f.severity, f.tier, f.dimension], [line, 3, 'test', true, 'info', 'likely', 'assertions']);
      assert.equal(f.testKey, `${f.file}#0`);
      assert.equal(f.title, 'Assertions only inside a loop over a list');
      testStates.enabled = false;
      let off: ScoreResult;
      try {
        off = await runFixture(name);
      } finally {
        testStates.enabled = true;
      }
      assert.equal(loopsOf(off).length, 0);
      // Since S9a the score is read from the test states: with the step off the result keeps the v4 numbers of
      // src/score-engine.ts (tests/test-states.test.ts), so score, grade, pass and status are compared through the
      // states instead: the loop finding charges no test.
      assert.deepEqual(on.dimensions, off.dimensions, 'dimensions');
      assert.ok((on.testStates ?? []).length > 0, 'the step ran');
      for (const s of on.testStates ?? []) assert.ok(!(s.chargedBy ?? []).some((r) => r.rule === LOOP_RULE), `${s.file}:${s.line} is charged by the loop finding`);
      const rest = (r: ScoreResult) => JSON.stringify(r.findings.filter((x) => x.rule !== LOOP_RULE && x.rule !== UNASSERTED_RULE));
      assert.equal(rest(on), rest(off));
    });
  }

  it('a loop in a beforeEach shared by two tests is reported once, as a hook finding', async () => {
    const r = await run(
      `test.beforeEach(async ({ page }) => {\n  await page.goto('/journal');\n  for (const card of await page.getByRole('article').all()) {\n    await expect(card).toBeVisible();\n  }\n});\n` +
        `test('opens a card', async ({ page }) => {\n  await page.getByRole('article').first().click();\n});\n` +
        `test('opens the archive', async ({ page }) => {\n  await page.getByRole('link', { name: 'Archive' }).click();\n});\n`
    );
    const hits = loopsOf(r);
    assert.deepEqual(hits.map((f) => [f.line, f.column, f.scope, f.testKey]), [[4, 3, 'hook', undefined]]);
  });

  it('nested loops give one finding, at the outer loop', async () => {
    const body = `test('every cell of every row', async ({ page }) => {\n  await page.goto('/table');\n  for (const row of await page.getByRole('row').all()) {\n    for (const cell of await row.getByRole('cell').all()) {\n      await expect(cell).not.toBeEmpty();\n    }\n  }\n});\n`;
    assert.deepEqual(await lines(body), [4]);
  });

  it('an assertion in a helper called inside the loop counts as inside; called before the loop, as outside', async () => {
    const helper = `async function checkCard(card) {\n  await expect(card).toBeVisible();\n}\n`;
    const inside = `${helper}test('cards', async ({ page }) => {\n  await page.goto('/journal');\n  for (const card of await page.getByRole('article').all()) {\n    await checkCard(card);\n  }\n});\n`;
    const before = `${helper}test('cards', async ({ page }) => {\n  await page.goto('/journal');\n  await checkCard(page.getByRole('article').first());\n  for (const card of await page.getByRole('article').all()) {\n    await expect(card).toBeVisible();\n  }\n});\n`;
    assert.deepEqual(await lines(inside), [7]);
    assert.deepEqual(await lines(before), []);
  });

  it('an action or a wait on the list before the loop waits for an item: no finding', async () => {
    const loop = `  for (const card of await cards.all()) {\n    await expect(card).toBeVisible();\n  }\n});\n`;
    const head = `test('cards', async ({ page }) => {\n  const cards = page.getByRole('article');\n`;
    assert.deepEqual(await lines(`${head}${loop}`), [4]);
    assert.deepEqual(await lines(`${head}  await cards.first().click();\n${loop}`), []);
    assert.deepEqual(await lines(`${head}  await page.getByRole('article').nth(1).hover();\n${loop}`), []);
    assert.deepEqual(await lines(`${head}  await page.waitForSelector('article');\n${loop}`), []);
    // Reading the list without waiting is not a wait.
    assert.deepEqual(await lines(`${head}  console.log(await cards.count(), await cards.allTextContents());\n${loop}`), [5]);
  });

  it('page.$$: a call with the same selector before the loop waits; another selector does not', async () => {
    const loop = `  for (const hit of await page.$$('.search-hit')) {\n    expect(await hit.textContent()).toContain('Plan');\n  }\n});\n`;
    const head = `test('hits', async ({ page }) => {\n  await page.goto('/search');\n`;
    assert.deepEqual(await lines(`${head}  await page.click('.search-hit');\n${loop}`), []);
    assert.deepEqual(await lines(`${head}  await page.click('.search-box');\n${loop}`), [5]);
  });

  it('a call the states could not resolve before the loop may assert: no finding; inside the loop it is part of the loop', async () => {
    const imp = `import { checkLayout } from 'acme-layout-checks';\n`;
    const before = `${imp}test('cards', async ({ page }) => {\n  await checkLayout(page);\n  for (const card of await page.getByRole('article').all()) {\n    await expect(card).toBeVisible();\n  }\n});\n`;
    const inside = `${imp}test('cards', async ({ page }) => {\n  for (const card of await page.getByRole('article').all()) {\n    await checkLayout(card);\n    await expect(card).toBeVisible();\n  }\n});\n`;
    assert.deepEqual(await lines(before), []);
    assert.deepEqual(await lines(inside), [4]);
  });

  it('lists that are not read without waiting, and a test with no assertion, give no finding', async () => {
    const t = (head: string, inner = `    await expect(rows.nth(i)).toBeVisible();\n`) =>
      `test('rows', async ({ page }) => {\n  const rows = page.getByRole('row');\n${head}${inner}  }\n});\n`;
    // a `let` bound count may be reassigned; the brief's shape is a `const` or the inline await
    assert.deepEqual(await lines(t(`  let n = await rows.count();\n  for (let i = 0; i < n; i++) {\n`)), []);
    assert.deepEqual(await lines(t(`  for (let i = 0; i < await rows.count(); i++) {\n`)), [4]);
    assert.deepEqual(await lines(t(`  for (let i = 0; i < 3; i++) {\n`)), []);
    assert.deepEqual(await lines(t(`  for (const i of [0, 1, 2]) {\n`)), []);
    assert.deepEqual(await lines(t(`  for (const row of await rows.all()) {\n`, `    await row.click();\n`)), []);
    assert.deepEqual(await lines(t(`  for (const row of await Promise.all([rows.first()])) {\n`, `    await expect(row).toBeVisible();\n`)), []);
  });

  it('the catalogue cell is report-only, likely and cites the locator.all() docs', () => {
    const row = defaultRow(LOOP_RULE);
    assert.ok(row);
    assert.deepEqual([row!.family, row!.design, row!.basis, row!.bcEligible, row!.reportOnly, row!.dimension], ['passes-regardless', 'likely', 'docs', false, true, 'assertions']);
    assert.equal(row!.docs, 'https://playwright.dev/docs/api/class-locator#locator-all');
    assert.equal(tierOf(row!), 'likely');
  });
});
