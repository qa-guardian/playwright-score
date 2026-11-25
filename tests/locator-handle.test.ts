import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { locatorHandles } from '../src/rules/locator-handle.js';
import type { Finding } from '../src/types.js';

// QAG-287 S4c: elementHandle() and elementHandles() on a proven Playwright Locator are reported as
// playwright/no-element-handle with form `locator-handle`. Positions below are counted by hand from the source
// text: the finding sits where the call (and its receiver) starts, as the rule's `page.$()` finding does.
// Names, selectors and values are invented.

const RULE = 'playwright/no-element-handle';
const DOCS = 'https://playwright.dev/docs/api/class-elementhandle';

const TRUE_SPEC = `import { test, expect, type Page } from '@playwright/test';

async function firstRow(page: Page) {
  return page.getByRole('row').nth(0).elementHandle();
}

test('orders', async ({ page }) => {
  await page.goto('/orders');
  const first = await page.getByRole('row').first().elementHandle();
  const rows = page.locator('tr');
  const totals = rows.filter({ hasText: 'Total' });
  const all = await totals.elementHandles();
  const card = await page.frameLocator('#pay').getByLabel('Card number').elementHandle();
  const p = page;
  const last = await p.locator('tbody').locator('tr').last().elementHandle();
  const sub = await page.mainFrame().getByTestId('subtotal').elementHandle();
  const one = await page.$('#row-1');
  await firstRow(page);
  expect([first, all, card, last, sub, one].length).toBe(6);
});
`;

const FALSE_SPEC = `import { test, expect, type Locator } from '@playwright/test';
import { findRow, grid } from 'table-row-kit';

async function handleOf(target) {
  return target.elementHandle();
}
async function typed(target: Locator) {
  return target.elementHandle();
}

test('orders', async ({ page }) => {
  const widget = { elementHandle: async () => null };
  await widget.elementHandle();
  let rows = page.locator('tr');
  rows = rows.filter({ hasText: 'Total' });
  await rows.elementHandles();
  let once = page.locator('tbody');
  await once.elementHandle();
  await findRow(page, 'Order 1001').elementHandle();
  await grid.locator('tr').elementHandles();
  const awaited = await page.locator('tfoot');
  await awaited.elementHandle();
  await page.frameLocator('#pay').elementHandle();
  await page.locator('tr')['elementHandle']();
  const own = { locator: () => ({ elementHandle: async () => null }) };
  await own.locator().elementHandle();
  const cells = page.locator('td');
  await Promise.all([1].map((cells) => cells.elementHandle()));
  await handleOf(page.locator('tr'));
  await typed(cells);
  await expect(page.locator('tr')).toHaveCount(3);
});
`;

async function score(spec: string, opts: { on?: boolean; file?: string; pkg?: string } = {}): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-lh-'));
  locatorHandles.enabled = opts.on ?? true;
  try {
    if (opts.pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: opts.pkg, version: '0.0.0', private: true }));
    fs.mkdirSync(path.join(dir, 'tests'));
    const file = path.join(dir, 'tests', opts.file ?? 'orders.spec.ts');
    fs.writeFileSync(file, spec);
    return (await scorePaths({ paths: [opts.pkg ? path.join(dir, 'tests') : file], profile: 'standard', threshold: 0, cwd: dir })).findings;
  } finally {
    locatorHandles.enabled = true;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const full = (f: Finding): string => JSON.stringify(f);
/** `on` minus `off` (multisets of whole findings); fails when `on` lacks a finding of `off`. */
function added(on: Finding[], off: Finding[]): Finding[] {
  const left = new Map<string, number>();
  for (const f of on) left.set(full(f), (left.get(full(f)) ?? 0) + 1);
  for (const f of off) {
    const n = left.get(full(f)) ?? 0;
    assert.ok(n > 0, `a finding without the step is missing or changed with it: ${full(f)}`);
    left.set(full(f), n - 1);
  }
  return on.filter((f) => {
    const n = left.get(full(f)) ?? 0;
    if (n > 0) left.set(full(f), n - 1);
    return n > 0;
  });
}
const where = (fs: Finding[]): string[] => fs.map((f) => `${f.rule}@${f.line}:${f.column} ${f.form}`).sort();

describe('QAG-287 S4c: elementHandle() on a proven Locator', () => {
  it('adds one finding per Locator chain or const-held Locator, and changes nothing else', async () => {
    const on = await score(TRUE_SPEC);
    const extra = added(on, await score(TRUE_SPEC, { on: false }));
    assert.deepEqual(where(extra), [
      `${RULE}@12:21 locator-handle`,
      `${RULE}@13:22 locator-handle`,
      `${RULE}@15:22 locator-handle`,
      `${RULE}@16:21 locator-handle`,
      `${RULE}@4:10 locator-handle`,
      `${RULE}@9:23 locator-handle`,
    ]);
    // The rule's own `page.$()` finding is still there, with its own form.
    assert.deepEqual(where(on.filter((f) => f.rule === RULE && f.form !== 'locator-handle')), [`${RULE}@17:21 -`]);
  });

  it('names the call in the message, says to use the Locator, and is advisory with the rule\'s docs, severity and dimension', async () => {
    const on = await score(TRUE_SPEC);
    const upstream = on.find((f) => f.rule === RULE && f.form === '-')!;
    const mine = on.filter((f) => f.form === 'locator-handle');
    assert.equal(mine.length, 6);
    for (const f of mine) {
      const call = f.line === 12 ? 'elementHandles' : 'elementHandle';
      assert.equal(f.message, `Unexpected use of element handles: use the Locator directly instead of calling ${call}().`);
      // Advisory by measurement since precision refresh 2 (labels/precision.json).
      assert.equal(f.tier, 'advisory');
      assert.equal(f.evidence, 'scope');
      assert.equal(f.docs, DOCS);
      assert.equal(f.title, 'Element handle taken from a locator');
      assert.equal(f.family, 'flake-risk');
      assert.equal(f.severity, upstream.severity);
      assert.equal(f.dimension, upstream.dimension);
      assert.equal(f.reportOnly, upstream.reportOnly);
    }
  });

  it('gives no finding of any form on a receiver it cannot prove to be a Locator', async () => {
    const on = await score(FALSE_SPEC);
    assert.deepEqual(where(on.filter((f) => f.rule === RULE)), []);
    assert.deepEqual(added(on, await score(FALSE_SPEC, { on: false })), []);
  });

  it('reports the same shapes in a JavaScript spec that requires the test package', async () => {
    const js = TRUE_SPEC.replace("import { test, expect, type Page } from '@playwright/test';", "const { test, expect } = require('@playwright/test');")
      .replace('async function firstRow(page: Page) {\n  return page.getByRole(\'row\').nth(0).elementHandle();\n}', 'async function firstRow(page) {\n  return page;\n}');
    const extra = added(await score(js, { file: 'orders.spec.js' }), await score(js, { file: 'orders.spec.js', on: false }));
    // The untyped `page` parameter of firstRow is not a proven page: its line now holds no call.
    assert.deepEqual(where(extra), [`${RULE}@12:21 locator-handle`, `${RULE}@13:22 locator-handle`, `${RULE}@15:22 locator-handle`, `${RULE}@16:21 locator-handle`, `${RULE}@9:23 locator-handle`]);
  });

  it('in a project that is a Playwright package, the added finding takes form api-under-test', async () => {
    const on = await score(TRUE_SPEC, { pkg: 'playwright-core' });
    const extra = added(on, await score(TRUE_SPEC, { pkg: 'playwright-core', on: false }));
    assert.equal(extra.length, 6);
    for (const f of extra) {
      assert.equal(f.form, 'api-under-test');
      assert.equal(f.tier, 'advisory');
      assert.match(f.message, /^Unexpected use of element handles: use the Locator directly instead of calling elementHandles?\(\)\.$/);
    }
    // Outside such a project the same calls keep `locator-handle`.
    const customer = await score(TRUE_SPEC, { pkg: 'orders-app-e2e' });
    assert.equal(customer.filter((f) => f.form === 'locator-handle').length, 6);
  });
});
