import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { uncheckedReadForm } from '../src/rules/unchecked-read.js';
import { ROWS, tierOf } from '../src/catalogue/index.js';
import type { Finding } from '../src/types.js';

// QAG-287 N2: pwscore/unchecked-read. Two forms, each its own cell: a discarded isVisible()/isHidden() statement, and
// an awaited read bound in a test, hook or step and never used. Shapes are written from playwright.dev, with invented names.

const RULE = 'pwscore/unchecked-read';
const PW = `import { test, expect } from '@playwright/test';\n`;

async function score(source: string, spec = 'a.spec.ts'): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-unchecked-'));
  try {
    fs.writeFileSync(path.join(dir, spec), source);
    const result = await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir });
    return result.findings.filter((f) => f.rule === RULE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const inTest = (lines: string[], header = PW): string => `${header}test('t', async ({ page }) => {\n${lines.map((l) => `  ${l}\n`).join('')}});\n`;
/** `line:form` of every finding of the rule; the first body line is line 3. */
const at = (fs_: Finding[]): string[] => fs_.map((f) => `${f.line}:${f.form}`).sort();

describe('QAG-287 N2: catalogue cells of unchecked-read', () => {
  it('has exactly the two forms, likely by design, in passes-regardless, each with a playwright.dev docs URL', () => {
    const rows = ROWS.filter((r) => r.rule === RULE);
    assert.deepEqual(rows.map((r) => r.form), ['discarded', 'unused-binding']);
    for (const r of rows) {
      assert.deepEqual([r.family, r.design, r.basis, tierOf(r), r.dimension, r.bcEligible], ['passes-regardless', 'likely', 'docs', 'likely', 'assertions', false], r.form);
      assert.match(r.docs ?? '', /^https:\/\/playwright\.dev\/docs\//, r.form);
    }
  });

  it('maps each message id to its form and nothing else', () => {
    assert.equal(uncheckedReadForm('discarded'), 'discarded');
    assert.equal(uncheckedReadForm('unusedBinding'), 'unused-binding');
    assert.equal(uncheckedReadForm('unawaited'), undefined);
    assert.equal(uncheckedReadForm(undefined), undefined);
  });
});

describe('QAG-287 N2: unchecked-read discarded', () => {
  it('reports an awaited and an unawaited isVisible()/isHidden() statement, through a const locator and a page alias', async () => {
    const found = await score(
      inTest([
        `await page.getByRole('button', { name: 'Checkout' }).isVisible();`, // 3
        `page.getByText('Loading').isHidden();`, // 4
        `const banner = page.getByRole('alert');`,
        `await banner.isVisible();`, // 6
        `const view = page;`,
        `await view.getByRole('dialog').isHidden();`, // 8
        `await page.isVisible('#promo');`, // 9
        `await page.locator('#menu').first().isVisible({ timeout: 5000 });`, // 10
      ]),
    );
    assert.deepEqual(at(found), ['10:discarded', '3:discarded', '4:discarded', '6:discarded', '8:discarded', '9:discarded']);
    const f = found.find((x) => x.line === 3)!;
    assert.equal(f.tier, 'likely');
    assert.equal(f.title, 'Visibility read that checks nothing');
  });

  it('reports in a helper and in a page-object method on this.page', async () => {
    const src = `${PW}async function waitMenu(page) {\n  await page.getByRole('menu').isVisible();\n}\nclass Nav {\n  constructor(page) { this.page = page; }\n  async open() {\n    await this.page.getByRole('navigation').isHidden();\n  }\n}\ntest('t', async ({ page }) => {\n  await waitMenu(page);\n  await new Nav(page).open();\n  await expect(page).toHaveURL('/');\n});\n`;
    assert.deepEqual(at(await score(src, 'b.spec.js')), ['3:discarded', '8:discarded']);
  });

  it('leaves a used, returned, bound, void-ed or chained call, other reads and unknown receivers', async () => {
    const found = await score(
      inTest([
        `if (await page.getByRole('dialog').isVisible()) await page.getByRole('button', { name: 'Close' }).click();`,
        `const shown = await page.getByRole('status').isVisible();`,
        `expect(shown).toBe(true);`,
        `void page.getByRole('status').isVisible();`,
        `await page.getByRole('heading').textContent();`,
        `await page.getByRole('row').count();`,
        `await page.getByRole('alert').isVisible().catch(() => false);`,
        `await page.getByRole('alert').isEnabled();`,
        `const widget = { isVisible: async () => true };`,
        `await widget.isVisible();`,
        `await widget.inner.isVisible();`,
        `expect(await page.getByRole('alert').isHidden()).toBe(true);`,
      ]),
    );
    assert.deepEqual(at(found), []);
    const ret = `${PW}async function shown(page) {\n  return page.getByRole('alert').isVisible();\n}\ntest('t', async ({ page }) => {\n  expect(await shown(page)).toBe(true);\n});\n`;
    assert.deepEqual(at(await score(ret)), []);
  });
});

describe('QAG-287 N2: unchecked-read unused-binding', () => {
  const READS = [
    `isVisible()`, `isHidden()`, `isEnabled()`, `isDisabled()`, `isChecked()`, `isEditable()`, `textContent()`, `innerText()`,
    `innerHTML()`, `inputValue()`, `getAttribute('href')`, `count()`, `allTextContents()`, `allInnerTexts()`, `boundingBox()`,
  ];

  it('reports every listed locator read bound and never used, and the page title and url', async () => {
    const lines = READS.map((r, i) => `const v${i} = await page.getByRole('link').${r};`);
    lines.push(`const t = await page.title();`, `let u = await page.url();`);
    const found = await score(inTest(lines));
    assert.deepEqual(at(found), lines.map((_, i) => `${i + 3}:unused-binding`).sort());
    assert.equal(found[0].title, 'Value read from the page and never checked');
    assert.ok(found.every((f) => f.tier === 'likely'));
  });

  it('reports in a hook, a step and a const locator, in a .js spec', async () => {
    const src = `${PW}test.beforeEach(async ({ page }) => {\n  const heading = await page.title();\n});\ntest('t', async ({ page }) => {\n  const email = page.getByLabel('Email');\n  const typed = await email.inputValue();\n  await test.step('total', async () => {\n    const total = await page.getByTestId('cart-total').innerText();\n  });\n  await expect(page).toHaveURL('/cart');\n});\n`;
    assert.deepEqual(at(await score(src, 'c.spec.js')), ['3:unused-binding', '7:unused-binding', '9:unused-binding']);
  });

  it('leaves a value that is asserted, used in a locator or URL, logged, written only through `_`, or bound some other way', async () => {
    const found = await score(
      inTest([
        `const rows = await page.getByRole('row').count();`,
        `expect(rows).toBe(3);`,
        `const id = await page.getByTestId('order').getAttribute('data-id');`,
        'await page.goto(`/orders/${id}`);',
        `const sku = await page.getByTestId('product').getAttribute('data-sku');`,
        'await page.locator(`[data-sku="${sku}"]`).click();',
        `const title = await page.title();`,
        `console.log(title);`,
        `const _count = await page.getByRole('listitem').count();`,
        `var old = await page.getByRole('row').count();`,
        `const { x } = await page.getByRole('img').boundingBox();`,
        `const pending = page.getByRole('row').count();`,
        `const label = await page.getByRole('button').getAttribute('aria-label') ?? '';`,
        `const plain = { count: async () => 1 };`,
        `const n = await plain.count();`,
        `const r = await page.getByRole('row').click();`,
      ]),
    );
    assert.deepEqual(at(found), []);
  });

  it('leaves a binding in a helper or in a nested callback of a test', async () => {
    const src = `${PW}async function total(page) {\n  const t = await page.getByTestId('cart-total').innerText();\n  const unused = await page.getByTestId('cart-total').innerText();\n  return t;\n}\ntest('t', async ({ page }) => {\n  page.on('load', async () => {\n    const c = await page.getByRole('row').count();\n  });\n  expect(await total(page)).toContain('$');\n});\n`;
    assert.deepEqual(at(await score(src)), []);
  });

  it('follows a test alias made with test.extend (the runner passes the alias names)', async () => {
    const src = `import { test as base, expect } from '@playwright/test';\nconst it2 = base.extend({});\nit2('t', async ({ page }) => {\n  const n = await page.getByRole('row').count();\n  await expect(page).toHaveTitle('Orders');\n});\n`;
    assert.deepEqual(at(await score(src)), ['4:unused-binding']);
  });
});
