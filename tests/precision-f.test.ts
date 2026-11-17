import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 slice F: post-filters for upstream eslint-plugin-playwright rules
// (corpus hand-check parts C1/C2). Each FALSE shape must stop firing; each TRUE
// shape must keep firing.

async function findingsFor(body: string, header = `import { test, expect } from '@playwright/test';`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-f-'));
  try {
    const file = path.join(dir, 'temp.spec.ts');
    fs.writeFileSync(file, `${header}\n${body}\n`);
    const r = await scorePaths({ paths: [file], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const found = async (rule: string, body: string, header?: string) =>
  (await findingsFor(body, header)).filter((f) => f.rule === rule);
const hits = async (rule: string, body: string, header?: string) => (await found(rule, body, header)).length;

const VALID = 'playwright/valid-expect';

describe('QAG-287 F1: valid-expect', () => {
  it('an expect returned from a named helper is not flagged (caller adds the matcher)', async () => {
    assert.equal(
      await hits(VALID, `
function verifyTiming(a: number, b: number) {
  return expect(a <= b);
}
const pollUrl = (page: any) => expect.poll(() => page.url());
const helpers = {
  check(x: number) {
    return expect(x);
  },
};
test('uses helpers', async ({ page }) => {
  verifyTiming(1, 2).toBe(true);
  await pollUrl(page).toContain('/home');
  helpers.check(1).toBe(1);
});`),
      0
    );
  });

  it('an expect stored in a variable and given a matcher later is not flagged', async () => {
    assert.equal(
      await hits(VALID, `
test('stored', async ({ page }) => {
  const poll = expect.poll(() => page.url());
  await poll.toContain('/home');
  const e = expect(page.locator('h1'));
  await e.toBeVisible();
});`),
      0
    );
  });

  it('a bare expect with no matcher still fires, also as a test arrow body or an unused variable', async () => {
    assert.equal(
      await hits(VALID, `
test('bare comparison', async ({ page }) => {
  const a = 2;
  const b = 1;
  expect(a > b);
});
test('arrow body', async () => expect(1 < 2));
test('never used', async ({ page }) => {
  const e = expect(page.locator('h1'));
  await page.goto('/');
});
test('await without matcher', async ({ page }) => {
  await expect(page.locator('h1'));
});`),
      4
    );
  });
});

const COND_EXPECT = 'playwright/no-conditional-expect';

describe('QAG-287 F2: no-conditional-expect', () => {
  it('an if/else (or else-if chain with a final else) where every arm asserts is not flagged', async () => {
    assert.equal(
      await hits(COND_EXPECT, `
test('every arm asserts', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) {
    await expect(page.locator('.menu-toggle')).toBeVisible();
  } else if (page.viewportSize()) {
    await expect(page.locator('.sidebar')).toBeVisible();
  } else {
    await expect(page.locator('.nav')).toBeVisible();
  }
});`),
      0
    );
  });

  it('an if without else, an arm with no assertion, a ternary or a catch still fire', async () => {
    assert.equal(
      await hits(COND_EXPECT, `
test('no else', async ({ page }) => {
  const count = await page.locator('.badge').count();
  if (count > 0) {
    await expect(page.locator('.badge')).toHaveText('1');
  }
});
test('silent arm', async ({ page }) => {
  if (await page.locator('.a').isVisible()) {
    await expect(page.locator('.a')).toHaveText('x');
  } else {
    await page.goto('/other');
  }
});
test('ternary', async ({ page }) => {
  const ok = (await page.locator('.a').count()) > 0;
  ok ? await expect(page.locator('.a')).toBeVisible() : null;
});
test('catch', async ({ page }) => {
  try {
    await page.goto('/');
  } catch {
    await expect(page.locator('.err')).toBeVisible();
  }
});`),
      4
    );
  });
});

const COND_IN_TEST = 'playwright/no-conditional-in-test';

describe('QAG-287 F3/F4: no-conditional-in-test, no-useless-await, no-eval', () => {
  it('a branch on live UI state stays a scored warning', async () => {
    const f = await found(COND_IN_TEST, `
test('live state', async ({ page }) => {
  await page.goto('/');
  if (await page.locator('.banner').isVisible()) {
    await page.locator('.banner button').click();
  }
  const open = await page.locator('.menu').getAttribute('aria-expanded');
  if (open === 'true') {
    await page.locator('.menu').click();
  }
  const label = (await page.locator('h1').count()) > 0 ? 'x' : 'y';
  await expect(page.locator('h1')).toHaveText(label);
});`);
    assert.equal(f.length, 3);
    assert.ok(f.every((x) => !x.reportOnly && x.severity === 'warning'));
  });

  it('a branch on static data or a fixture flag is information only', async () => {
    const f = await found(COND_IN_TEST, `
const timeout = process.env.CI ? 30000 : 10000;
test('static', async ({ page, isMobile }) => {
  await page.goto('/');
  const name = isMobile ? 'mobile' : 'desktop';
  for (const kind of ['a', 'b']) {
    if (kind === 'b') continue;
    await page.getByRole('button', { name }).click({ timeout });
  }
  const pick = name || 'fallback';
  await expect(page.locator('h1')).toBeVisible();
  if (isMobile) {
    await page.goto('/m');
  }
});`);
    assert.ok(f.length >= 3);
    assert.ok(f.every((x) => x.reportOnly === true && x.severity === 'info'));
  });

  it('no-useless-await and no-eval are report-only', async () => {
    const fs_ = await findingsFor(`
test('report only', async ({ page }) => {
  await page.goto('/');
  const h = await page.locator('h1').first();
  await expect(h).toBeVisible();
  const n = await page.$eval('h1', (e) => e.textContent);
  expect(n).toBe('x');
});`);
    const ua = fs_.filter((x) => x.rule === 'playwright/no-useless-await');
    const ev = fs_.filter((x) => x.rule === 'playwright/no-eval');
    assert.ok(ua.length >= 1 && ev.length >= 1);
    assert.ok([...ua, ...ev].every((x) => x.reportOnly === true && x.severity === 'info'));
  });
});
