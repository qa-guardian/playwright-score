import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { scopeAliases } from '../src/rules/aliased-page-api.js';
import type { Finding } from '../src/types.js';

// QAG-287 S4a: scope aliases of the page fixture, of `test` and of a const-held `networkidle`.
// Oracle: each added page-rule finding is the finding the same rule gives when the alias at that call is
// renamed to `page`. The alias `view` has the length of `page`, so a rename keeps every column below line 3.
// Names, selectors and values are invented.

const PAGE_BODY = (head: string, p: string): string => `import { test, expect } from '@playwright/test';

test('orders', async (${head}) => {
  await ${p}.goto('/orders');
  await ${p}.waitForSelector('#total');
  await Promise.all([${p}.waitForNavigation(), ${p}.getByRole('link', { name: 'Next' }).click()]);
  const row = await ${p}.$('#row-1');
  await ${p}.pause();
  await ${p}.waitForTimeout(500);
  ${p}.getByRole('button', { name: 'Pay' }).click();
  await expect(row).toBeTruthy();
});
`;
const OTHER = `import { test, expect } from '@playwright/test';

const it = test;
const settle = { waitUntil: 'networkidle' as const };
const state = 'networkidle';

it.only('orders', async ({ page }) => {
  await page.goto('/orders', settle);
  await page.waitForLoadState(state);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('summary', async ({ page }) => {
  await page.goto('/summary');
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
});
`;
const SHADOWED = `import { test, expect } from '@playwright/test';

async function open(view) {
  await view.waitForSelector('#total');
}

test('orders', async ({ page, context }) => {
  const view = page;
  await view.waitForTimeout(100);
  let tab = page;
  tab = await context.newPage();
  await tab.waitForTimeout(500);
  const pick = (view: { $: (s: string) => string }) => view.$('#row-1');
  expect(pick({ $: (s) => s })).toBe('#row-1');
  await open(page);
});
`;

async function score(spec: string, on = true): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-scope-'));
  scopeAliases.enabled = on;
  try {
    fs.writeFileSync(path.join(dir, 'orders.spec.ts'), spec);
    return (await scorePaths({ paths: [path.join(dir, 'orders.spec.ts')], profile: 'standard', threshold: 0, cwd: dir })).findings;
  } finally {
    scopeAliases.enabled = true;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const full = (f: Finding): string => JSON.stringify([f.rule, f.line, f.column, f.message, f.form, f.tier, f.severity, f.reportOnly, f.title, f.what, f.why, f.fix, f.docs, f.scope]);
/** `on` minus `off` (multisets); fails when `on` lacks a finding of `off`. Evidence is compared apart. */
function added(on: Finding[], off: Finding[]): Finding[] {
  const left = new Map<string, number>();
  for (const f of on) left.set(full(f) + f.evidence, (left.get(full(f) + f.evidence) ?? 0) + 1);
  for (const f of off) {
    const n = left.get(full(f) + f.evidence) ?? 0;
    assert.ok(n > 0, `a finding without the step is missing with it: ${full(f)}`);
    left.set(full(f) + f.evidence, n - 1);
  }
  return on.filter((f) => {
    const n = left.get(full(f) + f.evidence) ?? 0;
    if (n > 0) left.set(full(f) + f.evidence, n - 1);
    return n > 0;
  });
}
const where = (fs: Finding[]): string[] => fs.map((f) => `${f.rule}@${f.line}:${f.column}`).sort();

describe('QAG-287 S4a: scope aliases', () => {
  it('adds each page-rule finding on a renamed page fixture, equal to the finding on `page`, with evidence scope', async () => {
    const on = await score(PAGE_BODY('{ page: view }', 'view'));
    const extra = added(on, await score(PAGE_BODY('{ page: view }', 'view'), false));
    const oracle = await score(PAGE_BODY('{ page }', 'page'));
    assert.deepEqual(where(extra), [
      'playwright/no-element-handle@7:21',
      'playwright/no-page-pause@8:9',
      'playwright/no-wait-for-navigation@6:22',
      'playwright/no-wait-for-selector@5:9',
      'playwright/no-wait-for-timeout@9:9',
      'pwscore/no-unawaited-action@10:3',
    ]);
    for (const f of extra) {
      assert.equal(f.evidence, 'scope');
      assert.ok(oracle.some((o) => full(o) === full(f) && o.evidence === 'name'), `no oracle finding for ${full(f)}`);
    }
  });

  it('adds no-focused-test on a const alias of test and no-networkidle on const-held values, at the alias', async () => {
    const on = await score(OTHER);
    const extra = added(on, await score(OTHER, false));
    assert.deepEqual(where(extra), ['playwright/no-focused-test@7:4', 'playwright/no-networkidle@8:30', 'playwright/no-networkidle@9:31']);
    assert.ok(extra.every((f) => f.evidence === 'scope'));
  });

  it('adds nothing for an untyped parameter, a reassigned let or a parameter that shadows the alias', async () => {
    const on = await score(SHADOWED);
    const extra = added(on, await score(SHADOWED, false));
    assert.deepEqual(where(extra), ['playwright/no-wait-for-timeout@9:9']);
  });
});
