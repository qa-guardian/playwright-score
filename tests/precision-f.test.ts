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
