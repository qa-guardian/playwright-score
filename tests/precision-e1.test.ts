import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 slice E1: precision fixes from the corpus hand-check. Each FALSE
// shape (a hit that was not a real problem) must stop firing; each TRUE
// shape (a real problem) must keep firing.

async function ruleHits(rule: string, body: string): Promise<number> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-e1-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, `import { test, expect, type Page } from '@playwright/test';\n${body}\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.filter((f) => f.rule === rule).length;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SWALLOWED = 'pwscore/no-swallowed-assertion';

describe('QAG-287 E1: no-swallowed-assertion exempts a timed probe followed by a real check', () => {
  it('catch performs an action, then waits for the result (cleanup fallback)', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
test('cleanup', async ({ page }) => {
  try {
    await page.getByRole('link', { name: 'Delete' }).click();
    await expect(page.getByText('deleted')).toBeVisible({ timeout: 5000 });
  } catch (e) {
    await page.getByText('Yes, delete').click();
    await page.getByText('The plugin has been deleted').waitFor();
  }
});`),
      0
    );
  });

  it('probe helper returns on success and falls through to a fallback plus the same assertion', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
async function ensureExpanded(page: Page) {
  const zone = page.getByTestId('zone');
  try {
    await expect(zone).toBeVisible({ timeout: 12000 });
    return;
  } catch {
    /* still collapsed */
  }
  await page.getByTestId('rail').click();
  await expect(zone).toBeVisible({ timeout: 12000 });
}`),
      0
    );
  });

  it('expect.poll(...).catch used as a bounded wait, state re-read afterwards', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
test('replay', async ({ page }) => {
  let ready = false;
  await expect.poll(() => window_loaded(page), { timeout: 20000 }).toBe(true).catch(() => {});
  ready = window_loaded(page);
  if (!ready) test.info().annotations.push({ type: 'note', description: 'late' });
});
declare function window_loaded(p: Page): boolean;`),
      0
    );
  });

  it('a .catch probe whose subject is asserted hard afterwards', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
async function waitBusy(panel: import('@playwright/test').Locator) {
  await expect(panel).toHaveAttribute('data-busy', 'on', { timeout: 1000 }).catch(() => undefined);
  await expect(panel).toHaveAttribute('data-busy', '', { timeout: 30000 });
}`),
      0
    );
  });

  it('a JSON attempt in try, then a hard string assertion', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
async function check(value: string, actual: string) {
  try {
    const json = JSON.parse(actual);
    expect(json).toMatchObject(JSON.parse(value));
    return;
  } catch (_) {}
  expect(actual).toEqual(value);
}`),
      0
    );
  });

  it('a retry flag set in the try and re-checked afterwards', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
test('cookie', async ({ page }) => {
  let cookieSet = false;
  try {
    await expect.poll(async () => (await page.context().cookies()).length, { timeout: 5000 }).toBe(1);
    cookieSet = true;
  } catch {
    // cold compile
  }
  if (!cookieSet) {
    await page.click('#go');
    await expect.poll(async () => (await page.context().cookies()).length, { timeout: 20000 }).toBe(1);
  }
});`),
      0
    );
  });

  it('still reports a catch that only logs, even with an unrelated assertion afterwards', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
test('plugins installed', async ({ page }) => {
  for (const name of ['a', 'b']) {
    try {
      await expect(page.getByText(name)).toBeVisible();
    } catch (e) {
      console.log('missing ' + name);
    }
  }
  await expect(page.getByRole('heading')).toBeVisible();
});
test('tab membership', async ({ page }) => {
  try {
    await expect(page.getByText('Saved')).not.toBeVisible();
  } catch (e) {
    console.log('ignored');
  }
  await expect(page.getByRole('heading')).toBeVisible();
});`),
      1 // the loop one is skipped as a retry idiom; the second one fires
    );
  });

  it('still reports an empty catch with nothing afterwards, and a discarding .catch before an unrelated assertion', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
test('empty', async ({ page }) => {
  try {
    await expect(page.getByText('Policy unchanged')).toBeVisible();
  } catch {}
});
test('discard', async ({ page }) => {
  await expect(page.getByText('toast')).toBeVisible().catch(() => {});
  await expect(page.getByRole('heading')).toBeVisible();
});`),
      2
    );
  });

  it('still reports a flag assigned in the try but never read afterwards', async () => {
    assert.equal(
      await ruleHits(SWALLOWED, `
test('flag unused', async ({ page }) => {
  let seen = false;
  try {
    await expect(page.getByText('x')).toBeVisible();
    seen = true;
  } catch (e) {
    console.error('no x');
  }
});`),
      1
    );
  });
});

const TRIVIAL = 'pwscore/no-trivial-assertion';

describe('QAG-287 E1: no-trivial-assertion exempts intentional constant shapes', () => {
  it('marker expect(true) paired with expect(false) in the else arm, or an else that throws', async () => {
    assert.equal(
      await ruleHits(TRIVIAL, `
test('gate', async ({ page }) => {
  const n = await page.locator('#x').count();
  if (n === 1) {
    expect(true).toBeTruthy();
  } else {
    expect(false).toBeTruthy();
  }
  if (n === 1) {
    expect(true).toBe(true);
  } else {
    throw new Error('missing');
  }
});`),
      0
    );
  });

  it('dummy listener, type-level check and skipped placeholder', async () => {
    assert.equal(
      await ruleHits(TRIVIAL, `
test('listeners', () => {
  const e: any = { on(_n: string, _f: () => void) {} };
  const pass = () => expect(true).toBe(true);
  e.on('foo', pass);
  e.on('bar', () => expect(true).toBe(true));
});
test('types', () => {
  const selectors = { changing: 'a' };
  const name: keyof typeof selectors = 'changing';
  expect(name).toBe('changing');
});
test.skip('placeholder', async () => {
  expect(true).toBe(true);
});`),
      0
    );
  });

  it('still reports expect(true) filler, an else that merely passes, and an if with no else', async () => {
    assert.equal(
      await ruleHits(TRIVIAL, `
test('filler', async ({ page }) => {
  await page.getByRole('button').click();
  expect(true).toBe(true);
});
test('else passes', async ({ page }) => {
  const n = await page.locator('.x').count();
  if (n > 0) {
    await expect(page.locator('.x').first()).toBeVisible();
  } else {
    expect(true).toBeTruthy();
  }
});
test('no else', async ({ page }) => {
  const n = await page.locator('.x').count();
  if (n > 0) {
    expect(true).toBeTruthy();
  }
});
test('tautology', () => {
  const digest = 'abc';
  expect(digest).toBe('abc');
});`),
      4
    );
  });
});
