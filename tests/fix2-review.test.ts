import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 fix round 2: the 2.4.0 round-2 review found two more variants where
// an exemption hid a defect that published 2.3.0 reports. Every snippet is the
// reviewer's probe; it must fire.

async function findingsFor(rule: string, files: Record<string, string>, entry = 'temp.spec.ts') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-fix2-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const f = path.join(dir, name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    }
    const r = await scorePaths({ paths: [path.join(dir, entry)], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.filter((f) => f.rule === rule);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const spec = (body: string) => ({ 'temp.spec.ts': `import { test, expect } from '@playwright/test';\n${body}\n` });

const STANDALONE = 'playwright/no-standalone-expect';
const VALID = 'playwright/valid-expect';
const EXPECT_EXPECT = 'playwright/expect-expect';

describe('fix2 item A: a wrapper around test.describe is not a test alias', () => {
  it('arrow wrapper over test.describe reports an expect in the group body', async () => {
    const f = await findingsFor(STANDALONE, spec(`
const group = (name: string, fn: () => void) => test.describe(name, fn);
group('suite', () => {
  expect(1 + 2).toBe(3);
  test('inner', async ({ page }) => { await expect(page.getByText('a')).toBeVisible(); });
});`));
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 5);
  });

  it('function declaration wrapper over test.describe reports it too', async () => {
    const f = await findingsFor(STANDALONE, spec(`
function suite(name: string, fn: () => void) { test.describe(name, fn); }
suite('suite', () => {
  expect(2 + 2).toBe(4);
  test('inner', async ({ page }) => { await expect(page.getByText('a')).toBeVisible(); });
});`));
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 5);
  });

  it('a wrapper over a hook member is not a test alias either', async () => {
    const f = await findingsFor(STANDALONE, spec(`
const before = (fn: () => void) => test.beforeAll(fn);
before(() => { expect(1).toBe(1); });
test('inner', async ({ page }) => { await expect(page.getByText('a')).toBeVisible(); });`));
    assert.equal(f.length, 1);
  });

  it('wrappers that define a test (test, test.only, factory) stay exempt', async () => {
    const f = await findingsFor(STANDALONE, spec(`
const it = (name: string, fn: any) => test(name, fn);
function it2(name: string, fn: any) { test.only(name, fn); }
const it3 = test;
it('a', async ({ page }) => { expect(1 + 1).toBe(2); await expect(page.getByText('a')).toBeVisible(); });
it2('b', async ({ page }) => { expect(1 + 1).toBe(2); await expect(page.getByText('a')).toBeVisible(); });
it3('c', async ({ page }) => { expect(1 + 1).toBe(2); await expect(page.getByText('a')).toBeVisible(); });`));
    assert.equal(f.length, 0);
  });
});

describe('fix2 item B: a returned expect is exempt only when EVERY in-file caller chains a matcher', () => {
  const mixed = spec(`
function banner(page) {
  return expect(page.getByText('Saved'));
}
test('chains', async ({ page }) => {
  await banner(page).toBeVisible();
});
test('second caller forgets the matcher', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
  await banner(page);
});`);

  it('one chaining caller does not exempt the helper for a caller that does not', async () => {
    const f = await findingsFor(VALID, mixed);
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 4);
  });

  it('a helper that no caller ever chains reports expect-expect on its callers again', async () => {
    const f = await findingsFor(EXPECT_EXPECT, spec(`
function banner(page) {
  return expect(page.getByText('Saved'));
}
test('never chains', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
  await banner(page);
});`));
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 6);
  });

  it('the chaining sibling of a non-chaining caller is not flagged (no false expect-expect)', async () => {
    const f = await findingsFor(EXPECT_EXPECT, mixed);
    assert.equal(f.filter((x) => x.line === 6).length, 0);
  });

  it('every caller chaining (direct, awaited, stored) stays exempt', async () => {
    const body = spec(`
function banner(page) {
  return expect(page.getByText('Saved'));
}
test('a', async ({ page }) => { await banner(page).toBeVisible(); });
test('b', async ({ page }) => { await (await banner(page)).not.toBeHidden(); });
test('c', async ({ page }) => { const e = banner(page); await e.toBeVisible(); });`);
    assert.equal((await findingsFor(VALID, body)).length, 0);
    assert.equal((await findingsFor(EXPECT_EXPECT, body)).length, 0);
  });
});
