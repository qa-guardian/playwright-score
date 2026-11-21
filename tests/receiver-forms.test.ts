import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';
import { applyReceiverForms, receiverForms, RECEIVER_TIERED_RULES } from '../src/receiver-forms.js';
import { ROWS, rowFor, rowsOf, tierOf } from '../src/catalogue/index.js';
import type { Finding } from '../src/types.js';

// QAG-287 B2: receiver forms. A finding of a receiver-tiered rule keeps form `-` only when its receiver is
// proven to be a Playwright Page or Frame (E1 fixture, E2 type, E3 factory); otherwise it is still reported,
// as `unresolved`. Shapes are written from playwright.dev (and pptr.dev for the other library) with invented names.
// Every expectation is computed from RECEIVER_TIERED_RULES, so the suite holds with a rule in or out of the list.

const WFS = 'playwright/no-wait-for-selector';
const NAV = 'playwright/no-wait-for-navigation';
const EH = 'playwright/no-element-handle';
const PAUSE = 'playwright/no-page-pause';
const FOUR = [WFS, NAV, EH, PAUSE];
const PW = `import { test, expect } from '@playwright/test';\n`;
const tiered = (rule: string): boolean => RECEIVER_TIERED_RULES.includes(rule);
/** The form a finding of `rule` carries when its receiver is not proven. */
const un = (rule: string): string => (tiered(rule) ? 'unresolved' : '-');

async function score(files: Record<string, string>, spec = 'a.spec.ts'): Promise<Finding[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-recv-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    }
    return (await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir })).findings;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** `line:form` of every finding of the four rules, in line order. */
async function forms(files: Record<string, string> | string, spec = 'a.spec.ts'): Promise<string[]> {
  const all = await score(typeof files === 'string' ? { [spec]: files } : files, spec);
  return all
    .filter((f) => FOUR.includes(f.rule))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0))
    .map((f) => `${f.line}:${f.form}`);
}
const lines = (n: number, form: string, from = 1): string[] => Array.from({ length: n }, (_, i) => `${from + i}:${form}`);

describe('QAG-287 B2: the catalogue holds the unresolved cells as one data entry', () => {
  it('each receiver-tiered rule has an unresolved row that is likely, with the same docs, family and basis', () => {
    for (const rule of FOUR) {
      const base = rowFor(rule, '-')!;
      const row = rowFor(rule, 'unresolved');
      assert.equal(row !== undefined, tiered(rule), rule);
      assert.equal(rowsOf(rule).length, tiered(rule) ? 2 : 1, rule);
      if (!row) continue;
      assert.equal(tierOf(row), 'likely');
      assert.equal(row.design, 'likely');
      assert.equal(row.bcEligible, false);
      assert.equal(row.docsSentence, undefined);
      for (const k of ['docs', 'family', 'basis', 'dimension', 'label', 'severityOverride', 'reportOnly'] as const) assert.equal(row[k], base[k], `${rule} ${k}`);
    }
    assert.deepEqual(ROWS.filter((r) => r.form === 'unresolved').map((r) => r.rule), [...RECEIVER_TIERED_RULES]);
  });

  it('the unresolved copy never says the call is on a Playwright page and gives the fix conditionally', () => {
    for (const r of ROWS.filter((x) => x.form === 'unresolved')) {
      assert.match(r.what, /could not confirm is a Playwright Page/);
      assert.match(r.why, /^If this is a Playwright page, /);
      assert.match(r.fix, /^If this is a Playwright page, /);
      assert.doesNotMatch(r.what, /page\.[a-zA-Z$]+\(/, 'the copy must not name the API as page.<method>()');
      assert.doesNotMatch(r.title, /^(Legacy|Deprecated|Element|Debugger)/);
    }
  });
});

describe('QAG-287 B2: proven receivers keep form `-`', () => {
  it('E1: the fixture page of a test, a hook and a step, also renamed and through a const alias', async () => {
    const f = await forms(`${PW}test.beforeEach(async ({ page }) => { await page.waitForSelector('#a'); });
test('t', async ({ page }) => { await page.waitForSelector('#a'); });
test.only('t', async ({ page: shopPage }, testInfo) => { await shopPage.waitForNavigation(); });
test('t', { tag: '@slow' }, async ({ page }) => { const cartPage = page; const samePage = cartPage; await samePage.$('#a'); });
test('t', async ({ page }) => { await test.step('s', async () => { await page.pause(); }); });
test.describe('g', () => { test.skip('t', async ({ page }) => { await page.$$('li'); }); });
`);
    assert.deepEqual(f, lines(6, '-', 2));
  });

  it('E1: test from require, a namespace import, a default import, .extend and mergeTests in the same file', async () => {
    assert.deepEqual(await forms(`const { test } = require('@playwright/test');\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`, 'a.spec.js'), ['2:-']);
    assert.deepEqual(await forms(`const pw = require('@playwright/test');\npw.test('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`, 'a.spec.js'), ['2:-']);
    assert.deepEqual(await forms(`import * as pw from '@playwright/test';\npw.test('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`), ['2:-']);
    assert.deepEqual(await forms(`import base from '@playwright/test';\nbase('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`), ['2:-']);
    const f = await forms(`import { test as base, mergeTests } from '@playwright/test';
const withUser = base.extend({ user: async ({}, use) => { await use('ada'); } });
const withCart = withUser.extend({}).extend({});
const test = mergeTests(withUser, withCart);
const it = test;
it('t', async ({ page }) => { await page.waitForSelector('#a'); });
withCart('t', async ({ page }) => { await page.waitForNavigation(); });
`);
    assert.deepEqual(f, ['6:-', '7:-']);
  });

  it('E1: test re-exported by local modules, through a tsconfig path, CommonJS and export *', async () => {
    const spec = (from: string) => `import { test } from '${from}';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`;
    assert.deepEqual(await forms({ 'a.spec.ts': spec('./fixtures'), 'fixtures.ts': `import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n` }), ['2:-']);
    assert.deepEqual(await forms({ 'a.spec.ts': spec('./fixtures'), 'fixtures.ts': `import { test as base } from '@playwright/test';\nconst test = base.extend({});\nexport { test };\n` }), ['2:-']);
    assert.deepEqual(await forms({ 'a.spec.ts': spec('./fixtures'), 'fixtures.ts': `export * from './base';\n`, 'base.ts': `export { test } from '@playwright/test';\n` }), ['2:-']);
    assert.deepEqual(await forms({ 'a.spec.ts': spec('./fixtures'), 'fixtures.ts': `export * from '@playwright/test';\n` }), ['2:-']);
    assert.deepEqual(await forms({ 'a.spec.ts': `import test from './fixtures';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`, 'fixtures.ts': `import { test as base } from '@playwright/test';\nexport default base.extend({});\n` }), ['2:-']);
    assert.deepEqual(
      await forms({ 'a.spec.js': `const { test } = require('./fixtures');\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`, 'fixtures.js': `const base = require('@playwright/test');\nmodule.exports = { test: base.test.extend({}) };\n` }, 'a.spec.js'),
      ['2:-']
    );
    assert.deepEqual(
      await forms({ 'a.spec.ts': spec('@support/fixtures'), 'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@support/*': ['support/*'] } } }), 'support/fixtures.ts': `export { test } from '@playwright/test';\n` }),
      ['2:-']
    );
  });

  it('E1: a chain of four local modules is followed, a fifth is not', async () => {
    const hop = (n: number) => `export { test } from './f${n + 1}';\n`;
    const chain = (len: number): Record<string, string> => {
      const files: Record<string, string> = { 'a.spec.ts': `import { test } from './f1';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n` };
      for (let i = 1; i < len; i++) files[`f${i}.ts`] = hop(i);
      files[`f${len}.ts`] = `export { test } from '@playwright/test';\n`;
      return files;
    };
    assert.deepEqual(await forms(chain(4)), ['2:-']);
    assert.deepEqual(await forms(chain(5)), [`2:${un(WFS)}`]);
  });

  it('E2: Page and Frame annotations from a Playwright package', async () => {
    const f = await forms(`import { test, expect, type Page, type Frame as PwFrame } from '@playwright/test';
import type * as pw from 'playwright';
import type { Page as CorePage } from 'playwright-core';
let sharedPage: Page;
const lazyFrame: PwFrame = undefined as never;
async function a(page: Page, frame: PwFrame, corePage: CorePage, nsPage: pw.Page, inlinePage: import('@playwright/test').Page, optPage: Page = sharedPage) {
  await page.waitForSelector('#a');
  await frame.waitForSelector('#a');
  await corePage.waitForNavigation();
  await nsPage.$('#a');
  await inlinePage.pause();
  await optPage.$$('li');
}
test('t', async () => { await sharedPage.waitForSelector('#a'); await lazyFrame.$('#a'); });
class CartView {
  readonly page: Page;
  frame!: PwFrame;
  constructor(page: Page, private readonly otherPage: pw.Page) { this.page = page; }
  async rows() { await this.page.waitForSelector('#a'); return this.frame.$$('li'); }
  open = async () => { await this.otherPage.waitForNavigation(); };
}
`);
    assert.deepEqual(f, ['7:-', '8:-', '9:-', '10:-', '11:-', '12:-', '14:-', '14:-', '19:-', '19:-', '20:-']);
  });

  it('E3: factory calls on proven receivers and on launchers from a Playwright package', async () => {
    const f = await forms(`import { test, expect, chromium, _electron as electron } from '@playwright/test';
import playwright from 'playwright';
let latePage;
test.beforeAll(async ({ browser }) => { latePage = await browser.newPage(); });
test('t', async ({ page, context, browser }) => {
  await latePage.waitForSelector('#a');
  const tabPage = await context.newPage();
  await tabPage.waitForSelector('#a');
  const firstPage = context.pages()[0]; await firstPage.waitForNavigation();
  const popupPage = await page.waitForEvent('popup');
  await popupPage.$('#a');
  const newPage = await context.waitForEvent('page');
  await newPage.pause();
  await page.mainFrame().waitForSelector('#a');
  const childFrame = page.frame('checkout')!;
  await childFrame.$$('li');
  const lastFrame = page.frames()[1]; await lastFrame.waitForSelector('#a');
  const ownPage = await (await (await chromium.launch()).newContext()).newPage();
  await ownPage.waitForSelector('#a');
  const fxPage = await (await playwright.firefox.launch()).newPage();
  await fxPage.waitForSelector('#a');
  const persistentPage = (await chromium.launchPersistentContext('/tmp/profile')).pages()[0];
  await persistentPage.waitForSelector('#a');
  const electronApp = await electron.launch({ args: ['main.js'] });
  const windowPage = await electronApp.firstWindow();
  await windowPage.pause();
  const secondPage = await electronApp.waitForEvent('window');
  await secondPage.waitForSelector('#a');
  const ctxPage = await (await browser.newContext()).newPage();
  await ctxPage.waitForSelector('#a');
});
`);
    assert.deepEqual(f, [6, 8, 9, 11, 13, 14, 16, 17, 19, 21, 23, 26, 28, 30].map((n) => `${n}:-`));
  });

  it('a proven finding is certain only where the precision file says so, and an unresolved one never is', async () => {
    const all = await score({ 'a.spec.ts': `${PW}async function helper(page) { await page.waitForSelector('#a'); await page.waitForNavigation(); await page.$('#a'); await page.pause(); }
test('t', async ({ page }) => { await page.waitForSelector('#a'); await page.waitForNavigation(); await page.$('#a'); await page.pause(); });
` });
    for (const rule of FOUR) {
      const [unproven, proven] = all.filter((f) => f.rule === rule).sort((a, b) => a.line! - b.line!);
      assert.equal(proven.form, '-');
      assert.equal(proven.tier, tierOf(rowFor(rule, '-')!));
      assert.equal(unproven.form, un(rule));
      if (!tiered(rule)) continue;
      assert.equal(unproven.tier, 'likely');
      assert.equal(unproven.title, rowFor(rule, 'unresolved')!.title);
      assert.equal(unproven.docs, proven.docs);
      for (const k of ['rule', 'message', 'severity', 'dimension', 'reportOnly', 'family', 'basis', 'evidence', 'confidence', 'quotable'] as const) assert.deepEqual(unproven[k], proven[k], `${rule} ${k}`);
    }
  });
});

describe('QAG-287 B2: everything else is still reported, as unresolved', () => {
  const expectAll = async (rule: string, n: number, files: Record<string, string> | string, spec?: string) => {
    const f = await forms(files, spec);
    assert.equal(f.length, n, JSON.stringify(f));
    assert.ok(f.every((x) => x.endsWith(`:${un(rule)}`)), JSON.stringify(f));
  };

  it('unresolved by design: untyped parameters, helper returns, members of other objects, several writes, loop and catch bindings', async () => {
    await expectAll(WFS, 10, `import { test, expect, type Page } from '@playwright/test';
declare function openPage(): Promise<Page>;
async function helper(page, { somePage }, fixtures: { page: Page }) {
  await page.waitForSelector('#a');
  await somePage.waitForSelector('#a');
  await fixtures.page.waitForSelector('#a');
}
test('t', async ({ page, context }) => {
  const helperPage = await openPage();
  await helperPage.waitForSelector('#a');
  let mixedPage = await context.newPage();
  mixedPage = page;
  await mixedPage.waitForSelector('#a');
  let unsetPage;
  await unsetPage.waitForSelector('#a');
  for (const tabPage of context.pages()) await tabPage.waitForSelector('#a');
  try { await page.goto('/'); } catch (page) { await page.waitForSelector('#a'); }
  const [firstPage] = context.pages();
  await firstPage.waitForSelector('#a');
  const { page: nestedPage } = { page };
  await nestedPage.waitForSelector('#a');
});
`);
  });

  it('a fixture parameter that is reassigned, defaulted, nested or not the first parameter is not proof', async () => {
    await expectAll(WFS, 4, `${PW}const other: any = {};
test('t', async ({ page }) => { page = other; await page.waitForSelector('#a'); });
test('t', async ({ page = other }) => { await page.waitForSelector('#a'); });
test('t', async ({ fx: { page } }: any) => { await page.waitForSelector('#a'); });
test('t', async (info: any, { page }: any) => { await page.waitForSelector('#a'); });
`);
  });

  it('a callback that is not passed to Playwright test is not proof: describe, fixtures of extend, another runner, a local test function', async () => {
    await expectAll(WFS, 2, `${PW}test.describe('g', ({ page }: any) => { page.waitForSelector('#a'); });
const t2 = test.extend({ shop: async ({ page }, use) => { await page.waitForSelector('#a'); await use(1); } });
`);
    await expectAll(WFS, 1, `import { test } from 'vitest';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`);
    await expectAll(WFS, 1, `function test(name, fn) { return fn({ page: {} }); }\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`, 'a.spec.js');
    await expectAll(WFS, 1, `import { test as base } from '@playwright/test';\nlet test = base;\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`);
    await expectAll(WFS, 1, `import { test as base, mergeTests } from '@playwright/test';\nimport { test as other } from 'vitest';\nconst test = mergeTests(base, other as never);\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`);
  });

  it('a test import that does not resolve, resolves to a module that builds its own test, or exports it twice is not proof', async () => {
    const spec = `import { test } from './fixtures';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n`;
    await expectAll(WFS, 1, spec);
    await expectAll(WFS, 1, { 'a.spec.ts': spec, 'fixtures.ts': `export function test(name: string, fn: (f: any) => unknown) { return fn({ page: {} }); }\n` });
    await expectAll(WFS, 1, { 'a.spec.ts': spec, 'fixtures.ts': `import { test as base } from '@playwright/test';\nexport let test = base;\n` });
    await expectAll(WFS, 1, { 'a.spec.ts': spec, 'fixtures.ts': `import { wrap } from './wrap';\nimport { test as base } from '@playwright/test';\nexport const test = wrap(base);\n`, 'wrap.ts': `export const wrap = (t: any) => t;\n` });
    await expectAll(WFS, 1, { 'a.spec.ts': spec, 'fixtures.ts': `export * from './one';\nexport * from './two';\n`, 'one.ts': `export { test } from '@playwright/test';\n`, 'two.ts': `export const other = 1;\n` });
    await expectAll(WFS, 1, { 'a.spec.ts': spec, 'fixtures.ts': `export { test } from './fixtures';\n` });
    await expectAll(WFS, 1, { 'a.spec.ts': `import { test } from '@acme/fixtures';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n` });
  });

  it('a type that is not Playwright Page or Frame is not proof', async () => {
    await expectAll(NAV, 8, `import { test, expect, type Locator, type Page as PwPage } from '@playwright/test';
import type { Page } from 'puppeteer';
import type { Frame } from './types';
interface OwnPage { waitForNavigation(): Promise<void> }
type Maybe<T> = T | undefined;
async function a<DetailsPage extends OwnPage>(page: Page, frame: Frame, ownPage: OwnPage, anyPage: any, genericPage: DetailsPage, maybePage: Maybe<PwPage>, unionPage: PwPage | OwnPage, locatorPage: Locator) {
  await page.waitForNavigation();
  await frame.waitForNavigation();
  await ownPage.waitForNavigation();
  await anyPage.waitForNavigation();
  await genericPage.waitForNavigation();
  await maybePage.waitForNavigation();
  await unionPage.waitForNavigation();
  const castPage = locatorPage as unknown as PwPage;
  await castPage.waitForNavigation();
}
`);
  });

  it('this.x is proof only for a typed field of the enclosing class instance', async () => {
    await expectAll(EH, 7, `import { test, expect, type Page } from '@playwright/test';
class Untyped { page; constructor(page: Page) { this.page = page; } a() { return this.page.$('#a'); } }
class Accessor { get page(): Page { return undefined as never; } a() { return this.page.$('#a'); } }
class Base { readonly page!: Page; }
class Inherits extends Base { a() { return this.page.$('#a'); } }
class Static { static page: Page; page: any; static a() { return this.page.$('#a'); } }
class Twice { page!: Page; constructor(public page: Page) {} a() { return this.page.$('#a'); } }
class Nested { page!: Page; a() { return { b() { return this.page.$('#a'); } }; } c() { return function (this: any) { return this.page.$('#a'); }; } }
`);
    await expectAll(EH, 1, `class Legacy { constructor(page) { this.page = page; } rows() { return this.page.$$('li'); } }\n`, 'a.spec.js');
  });

  it('a factory call is proof only on a proven receiver of the right kind', async () => {
    await expectAll(PAUSE, 9, `${PW}import puppeteer from 'puppeteer';
import { chromium } from './browsers';
import { firefox } from 'playwright';
declare const somewhere: any;
test('t', async ({ page, context }) => {
  const otherPage = await (await puppeteer.launch()).newPage();
  await otherPage.pause();
  const localPage = await (await chromium.launch()).newPage();
  await localPage.pause();
  const helperPage = await somewhere.newPage();
  await helperPage.pause();
  const eventPage = await page.waitForEvent('download');
  await eventPage.pause();
  const wrongPage = await page.newPage();
  await wrongPage.pause();
  const listPage = context.pages().at(-1);
  await listPage.pause();
  const frame = page.mainFrame();
  await frame.pause();
  let laterPage = await context.newPage();
  laterPage ??= await context.newPage();
  await laterPage.pause();
  const launcherPage: any = firefox;
  await launcherPage.pause();
});
`);
  });
});

describe('QAG-287 B2: earlier reviewer probes stay reported', () => {
  it('a page object whose own method shares the Playwright name; a typed page-object parameter', async () => {
    const page = `export class DetailsPage {\n  constructor(private readonly page: unknown) {}\n  async waitForNavigation() {}\n}\n`;
    assert.deepEqual(await forms({ 'a.spec.ts': `${PW}import { DetailsPage } from './details-page';
async function check(detailsPage: DetailsPage) { await detailsPage.waitForNavigation(); }
test('t', async ({ page }) => {
  const detailsPage = new DetailsPage(page);
  await detailsPage.waitForNavigation();
  await check(detailsPage);
  const samePage = page;
  await samePage.waitForNavigation();
});
`, 'details-page.ts': page }), [`3:${un(NAV)}`, `6:${un(NAV)}`, '9:-']);
  });

  it('another library: direct import, assigned in a hook, through a local helper, mixed with a Playwright page', async () => {
    assert.deepEqual(await forms(`${PW}import puppeteer from 'puppeteer';
let page: any;
test.beforeAll(async () => { page = await (await puppeteer.launch()).newPage(); });
test('t', async ({ page: fixturePage }) => {
  await page.$('h1');
  page = fixturePage;
  await page.$$('li');
  await fixturePage.$('h1');
});
`), [`6:${un(EH)}`, `8:${un(EH)}`, '9:-']);
    assert.deepEqual(await forms({ 'a.spec.ts': `${PW}import { launchAny, chromium } from './browsers';
test('t', async () => {
  const page = await (await launchAny()).newPage();
  await page.$('h1');
  const secondPage = await (await chromium.launch()).newPage();
  await secondPage.$('h1');
});
`, 'browsers.ts': `import puppeteer from 'puppeteer';\nexport { chromium } from 'playwright-chromium';\nimport { chromium } from 'playwright-chromium';\nexport const launchAny = () => (process.env.OLD ? puppeteer.launch() : chromium.launch());\n` }), [`5:${un(EH)}`, `7:${un(EH)}`]);
  });

  it('a Playwright page that shadows or reassigns another page: for-of, for-in, catch, destructuring, logical assignment, var', async () => {
    assert.deepEqual(await forms(`${PW}import puppeteer from 'puppeteer';
test('t', async ({ context, browser: pw, page: fixturePage }) => {
  const page = await (await puppeteer.launch()).newPage();
  for (const page of context.pages()) { await page.$('h1'); }
  const tabs: Record<string, any> = {};
  for (const page in tabs) { await tabs[page].$('h1'); }
  try { await fixturePage.goto('/'); } catch (page: any) { await page.$('h1'); }
  let nextPage: any = page;
  ({ nextPage } = { nextPage: await pw.newPage() });
  await nextPage.$('h1');
  nextPage ??= fixturePage;
  nextPage ||= fixturePage;
  nextPage &&= fixturePage;
  await nextPage.$('h1');
  var oldPage = await pw.newPage();
  { var oldPage = await pw.newPage(); }
  await oldPage.$('h1');
  { const page = fixturePage; await page.$('h1'); }
  await page.$('h1');
});
`), [`5:${un(EH)}`, `7:${un(EH)}`, `8:${un(EH)}`, `11:${un(EH)}`, `15:${un(EH)}`, `18:${un(EH)}`, '19:-', `20:${un(EH)}`]);
  });

  it('rules outside the list are unchanged by the step: page-object locators and forwarded options', async () => {
    const cart = `import type { Page } from '@playwright/test';
export class CartPage {
  constructor(private readonly page: Page) {}
  get checkoutButton() { return this.page.locator('#checkout'); }
  row(n: number) { return this.page.getByRole('row').nth(n); }
  panel = () => this.page.getByRole('region');
}
`;
    const files = { 'a.spec.ts': `${PW}import { CartPage } from './cart-page';
test('cart', async ({ page }) => {
  const cartPage = new CartPage(page);
  await cartPage.checkoutButton.click({ force: true });
  await cartPage.row(1).click({ force: true });
  await cartPage.panel().click({ force: true });
  await cartPage.checkoutButton.locator('div > span.price').click();
  await page.goto('/cart', { waitUntil: 'networkidle' });
});
`, 'cart-page.ts': cart };
    const on = await score(files);
    receiverForms.enabled = false;
    let off: Finding[];
    try {
      off = await score(files);
    } finally {
      receiverForms.enabled = true;
    }
    assert.deepEqual(on, off);
    const count = (rule: string) => on.filter((f) => f.rule === rule).length;
    assert.equal(count('playwright/no-force-option'), 3);
    assert.equal(count('playwright/no-raw-locators'), 1);
    assert.equal(count('playwright/no-networkidle'), 1);
    assert.ok(on.every((f) => f.form !== 'unresolved'));
  });
});

describe('QAG-287 B2: the step never adds, removes or rewrites a finding', () => {
  const SOURCES: Array<Record<string, string>> = [
    { 'a.spec.ts': `${PW}async function helper(page) { await page.waitForSelector('#a'); await page.waitForNavigation(); await page.$('#a'); await page.pause(); }
test('t', async ({ page }) => { await page.waitForSelector('#a').catch(() => {}); await page.waitForNavigation(); await page.$('#a'); await page.pause(); await page.waitForTimeout(5); expect(await page.isVisible('#a')).toBe(true); });
` },
    { 'a.spec.ts': `import { test } from './fixtures';\ntest('t', async ({ page }) => { await page.$('a').then((h) => h); await page.locator('x').click({ force: true }); });\n`, 'fixtures.ts': `import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n` },
    { 'a.spec.ts': `import { test } from './missing';\ntest('t', async ({ page }) => { await page.waitForSelector('#a'); });\n` },
  ];
  const key = (f: Finding) => [f.rule, f.file, f.line, f.column, f.message].join('|');
  const strip = ({ form: _f, tier: _t, title: _ti, what: _w, why: _y, fix: _x, confidence: _c, ...rest }: Finding) => rest;

  it('the same sources give the same (rule, file, line, column, message) with the step on and off', async () => {
    for (const files of SOURCES) {
      const on = await score(files);
      receiverForms.enabled = false;
      let off: Finding[];
      try {
        off = await score(files);
      } finally {
        receiverForms.enabled = true;
      }
      assert.ok(on.some((f) => FOUR.includes(f.rule)));
      assert.deepEqual(on.map(key).sort(), off.map(key).sort());
      // Same order, and every field but form, tier and copy is equal for the four rules; every other finding is identical.
      assert.equal(on.length, off.length);
      on.forEach((f, i) => {
        if (tiered(f.rule)) assert.deepEqual(strip(f), strip(off[i]));
        else assert.deepEqual(f, off[i]);
      });
      for (const f of on.filter((x) => tiered(x.rule))) assert.ok(f.form === '-' || f.form === 'unresolved', `${f.rule} form ${f.form}`);
      for (const f of off.filter((x) => tiered(x.rule))) assert.equal(f.form, undefined);
    }
  });

  it('a finding that already has a form, and a finding of any other rule, is left alone', () => {
    const ctx = { filesBase: os.tmpdir(), sources: new Map<string, string>() };
    const base = { severity: 'warning', message: 'm', file: 'a.spec.ts', line: 1, column: 1, dimension: 'playwrightHygiene' } as const;
    const findings: Finding[] = [{ ...base, rule: FOUR[0], form: 'api-under-test' }, { ...base, rule: 'playwright/no-networkidle' }, { ...base, rule: 'playwright/no-wait-for-timeout' }];
    const before = JSON.parse(JSON.stringify(findings));
    applyReceiverForms(findings, ctx);
    assert.deepEqual(findings, before);
  });
});

describe('QAG-287 B2: the step never throws', () => {
  const finding = (over: Partial<Finding>): Finding => ({ rule: EH, severity: 'warning', message: 'm', file: 'a.spec.ts', line: 1, column: 1, dimension: 'playwrightHygiene', ...over });

  it('fuzz: hostile findings and contexts yield unresolved', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-recv-fuzz-'));
    try {
      const abs = path.join(dir, 'a.spec.ts');
      const good = `${PW}test('t', async ({ page }) => { await page.$('#a'); });\n`;
      const throwing = new Map<string, string>();
      throwing.get = () => {
        throw new Error('boom');
      };
      const contexts = [
        { filesBase: dir, sources: new Map([[abs, good]]) },
        { filesBase: dir, sources: new Map<string, string>() },
        { filesBase: dir, sources: new Map([[abs, 'test(( => {']]) },
        { filesBase: dir, sources: new Map([[abs, undefined as unknown as string]]) },
        { filesBase: dir, sources: new Map([[abs, 42 as unknown as string]]) },
        { filesBase: dir, sources: throwing },
        { filesBase: undefined as unknown as string, sources: new Map([[abs, good]]) },
        { filesBase: dir, sources: undefined as unknown as Map<string, string> },
        { filesBase: dir, sources: new Map([[abs, good]]), moduleResolver: () => { throw new Error('boom'); } },
        null as unknown as { filesBase: string; sources: Map<string, string> },
      ];
      const shapes: Array<Partial<Finding>> = [
        {}, { line: undefined }, { column: undefined }, { line: -1, column: -1 }, { line: 1e9, column: 1e9 }, { line: NaN, column: NaN },
        { line: '2' as unknown as number }, { file: '../../../../etc/passwd' }, { file: '\u0000' }, { file: '' }, { file: undefined as unknown as string },
        { file: dir }, { line: 2, column: 39 }, { line: 2, column: 33 }, { rule: PAUSE, line: 2, column: 39 },
      ];
      for (const ctx of contexts) {
        for (const shape of shapes) {
          const findings = [finding(shape)];
          assert.doesNotThrow(() => applyReceiverForms(findings, ctx));
          assert.equal(findings.length, 1);
          const isRealProof = (ctx === contexts[0] || ctx === contexts[8]) && shape.line === 2 && shape.column === 39 && shape.rule === undefined;
          assert.equal(findings[0].form, tiered(findings[0].rule) ? (isRealProof ? '-' : 'unresolved') : undefined, JSON.stringify(shape));
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fuzz: cycles, deep chains and odd syntax resolve to unresolved without throwing', async () => {
    const deep = `page${'.mainFrame().page'.repeat(40)}`;
    const alias = Array.from({ length: 40 }, (_, i) => `const p${i + 1}Page = p${i}Page;`).join(' ');
    const f = await forms({ 'a.spec.ts': `import { test } from './loop-a';
import * as self from './a.spec';
const aPage = bPage; const bPage = aPage;
const selfPage = selfPage;
test('t', async ({ page }) => {
  await aPage.$('#a');
  await selfPage.$('#a');
  await ${deep}.$('#a');
  const p0Page = page; ${alias}
  await p40Page.$('#a');
  await page['$']('#a');
  await (page as any)['$$'](\`li\`);
  await page.$('a').$('b');
  await self.page.$('#a');
  await import.meta.page.$('#a');
  await this.page.$('#a');
  await page.constructor.page.$('#a');
  await page.toString().page.$('#a');
  await page.__proto__.framePage.$('#a');
});
class K { static { this.page.$('#a'); } [this.page.$('#a')]() {} }
`, 'loop-a.ts': `export * from './loop-b';\nexport { test } from './loop-b';\n`, 'loop-b.ts': `export * from './loop-a';\nexport { test } from './loop-a';\n` });
    assert.ok(f.length >= 6, JSON.stringify(f));
    assert.ok(f.every((x) => x.endsWith(`:${un(EH)}`)), JSON.stringify(f));
  });

  it('a five-step alias chain is followed; a call that could be either of two at one position needs both proven', async () => {
    const alias = Array.from({ length: 5 }, (_, i) => `const p${i + 1}Page = p${i}Page;`).join(' ');
    assert.deepEqual(await forms(`${PW}test('t', async ({ page }) => { const p0Page = page; ${alias}\n  await p5Page.$('#a');\n  await page.$('#a').$('#b');\n});\n`), ['3:-', `4:${un(EH)}`]);
  });
});
