import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 slice E3: precision fixes from the corpus hand-check (part B1).
// Each FALSE shape must stop firing; each TRUE shape must keep firing.

async function findingsFor(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-e3-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, `import { test, expect } from '@playwright/test';\n${body}\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const hits = async (rule: string, body: string) => (await findingsFor(body)).filter((f) => f.rule === rule).length;

const BRITTLE = 'pwscore/no-brittle-selector';
const SERIAL = 'pwscore/serial-mode-dependency';
const SHARED = 'pwscore/no-shared-mutable-state';
const FALLBACK = 'pwscore/no-self-fulfilling-fallback';

describe('QAG-287 E3: no-brittle-selector positional picks', () => {
  it('comma-union selector with .first() is an either/or wait, not a position', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('either state', async ({ page }) => {
  await page.goto('/');
  await page.locator('.result-ok, .result-error').first().waitFor();
  await expect(page.locator('.alert, [role=alert]').first()).toBeVisible();
});`),
      0
    );
  });

  it('existence, count and attribute probes on .first() do not fire', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('probes', async ({ page }) => {
  await page.goto('/');
  const shown = await page.locator('.card').first().isVisible();
  const href = await page.locator('.nav a').first().getAttribute('href');
  expect(shown).toBe(true);
  expect(href).toContain('/docs');
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('.card').last()).not.toBeHidden();
  await expect(page.locator('.card').nth(1)).toHaveAttribute('data-state', 'open');
});`),
      0
    );
  });

  it('a locator already scoped under a test id or role parent does not fire', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('scoped', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('results').locator('.row').first().click();
  await page.getByRole('dialog').locator('input.name').first().fill('x');
  await page.locator('[data-testid=panel]').locator('.item').nth(2).click();
});`),
      0
    );
  });

  it('bare positional pick used for a click on an unscoped CSS locator still fires', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('pick', async ({ page }) => {
  await page.goto('/');
  await page.locator('.btn.primary').first().click();
});`),
      1
    );
  });

  it('nth() pick for fill, and a text assertion on a raw .last(), still fire', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('pick more', async ({ page }) => {
  await page.goto('/');
  await page.locator('form input.field').nth(2).fill('x');
  await expect(page.locator('.row').last()).toHaveText('done');
});`),
      2
    );
  });

  it('XPath selectors keep firing', async () => {
    assert.equal(
      await hits(BRITTLE, `
test('xpath', async ({ page }) => {
  await page.locator('//div[@class="a"]/span[2]').click();
  await page.locator('xpath=..').click();
});`),
      2
    );
  });
});

