import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scorePaths } from '../src/index.js';

// QAG-287 S4a-R (ADR 0.H H-3): Page/Frame-API rules must not report when the
// receiver is provably not a Playwright Page/Frame, and must keep reporting
// whenever resolution is unknown. Fixtures are written from the Playwright
// and Puppeteer docs.

async function rulesFor(files: Record<string, string>, spec = 'a.spec.ts'): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-score-s4ar-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    }
    const r = await scorePaths({ paths: [path.join(dir, spec)], profile: 'standard', threshold: 0, cwd: dir });
    return r.findings.map((f) => f.rule);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const PW = `import { test, expect } from '@playwright/test';\n`;
const NAV = 'playwright/no-wait-for-navigation';
const EH = 'playwright/no-element-handle';
const count = (rules: string[], rule: string) => rules.filter((r) => r === rule).length;

describe('QAG-287 S4a-R: receiver is not a Playwright Page (FALSE shapes)', () => {
  it('false-page-object-own-waitForNavigation', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import { DetailsPage } from './details-page';
test('opens details', async ({ page }) => {
  const detailsPage = new DetailsPage(page);
  await detailsPage.waitForNavigation();
  await expect(page).toHaveURL(/details/);
});`,
      'details-page.ts': `import { expect, type Page } from '@playwright/test';
export class DetailsPage {
  constructor(private readonly page: Page) {}
  async waitForNavigation() { await expect(this.page).toHaveURL(/details/); }
}`,
    });
    assert.equal(count(rules, NAV), 0);
  });

  it('false-page-object-typed-parameter', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import { DetailsPage } from './details-page';
async function check(detailsPage: DetailsPage) { await detailsPage.waitForNavigation(); }
test('typed', async ({ page }) => { await check(new DetailsPage(page)); });`,
      'details-page.ts': `export class DetailsPage {
  constructor(private readonly page: unknown) {}
  async waitForNavigation() {}
}`,
    });
    assert.equal(count(rules, NAV), 0);
  });

  it('false-puppeteer-direct-import-page-$$', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import puppeteer from 'puppeteer';
test('legacy check', async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const items = await page.$$('li');
  expect(items.length).toBeGreaterThan(0);
  await browser.close();
});`,
    });
    assert.equal(count(rules, EH), 0);
  });

  it('false-puppeteer-core-assigned-in-hook', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import * as puppeteer from 'puppeteer-core';
let browser: any;
let page: any;
test.beforeAll(async () => {
  browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium' });
  page = await browser.newPage();
});
test('legacy', async () => { const el = await page.$('h1'); expect(el).toBeTruthy(); });`,
    });
    assert.equal(count(rules, EH), 0);
  });

  it('false-puppeteer-via-local-helper-module', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import { launchPuppeteer } from './puppeteer-browser';
test('legacy check', async () => {
  const browser = await launchPuppeteer();
  const page = await browser.newPage();
  const items = await page.$$('li');
  expect(items.length).toBeGreaterThan(0);
});`,
      'puppeteer-browser.ts': `import puppeteer from 'puppeteer';
export async function launchPuppeteer() { return puppeteer.launch({ headless: true }); }`,
    });
    assert.equal(count(rules, EH), 0);
  });
});

describe('QAG-287 S4a-R: receiver may be a Playwright Page (TRUE shapes keep firing)', () => {
  it('true-fixture-page', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}test('x', async ({ page }) => {
  await page.goto('/');
  await page.waitForNavigation();
  const el = await page.$('h1');
});`,
    });
    assert.equal(count(rules, NAV), 1);
    assert.equal(count(rules, EH), 1);
  });

  it('true-this-page-in-page-object', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import type { Page } from '@playwright/test';
class Home {
  constructor(private page: Page) {}
  async go() { await this.page.waitForNavigation(); }
}
test('x', async ({ page }) => { await new Home(page).go(); });`,
    });
    assert.equal(count(rules, NAV), 1);
  });

  it('true-typed-page-parameter', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import type { Page } from '@playwright/test';
async function nav(page: Page) { await page.waitForNavigation(); }
test('x', async ({ page }) => { await nav(page); });`,
    });
    assert.equal(count(rules, NAV), 1);
  });

  it('true-untyped-helper-parameter', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}async function nav(somePage) { await somePage.waitForNavigation(); }
test('x', async ({ page }) => { await nav(page); });`,
    });
    assert.equal(count(rules, NAV), 1);
  });

  it('true-playwright-chromium-launch-newPage', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `import { test, expect, chromium } from '@playwright/test';
test('x', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const el = await page.$('h1');
});`,
    });
    assert.equal(count(rules, EH), 1);
  });

  it('true-page-object-class-without-the-method-assigned-fixture-page', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import { DetailsPage } from './details-page';
test('x', async ({ page }) => {
  const detailsPage = page;
  const otherPage = new DetailsPage(page);
  await detailsPage.waitForNavigation();
  await otherPage.waitForNavigation();
});`,
      'details-page.ts': `export class DetailsPage {
  constructor(private readonly page: unknown) {}
  async open() {}
}`,
    });
    assert.equal(count(rules, NAV), 2);
  });

  it('true-helper-module-imports-puppeteer-and-playwright', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import { launchAny } from './browsers';
test('x', async () => {
  const browser = await launchAny();
  const page = await browser.newPage();
  const el = await page.$('h1');
});`,
      'browsers.ts': `import puppeteer from 'puppeteer';
import { chromium } from 'playwright';
export async function launchAny() { return chromium.launch(); }`,
    });
    assert.equal(count(rules, EH), 1);
  });

  it('true-puppeteer-browser-plus-playwright-assignment-is-mixed', async () => {
    const rules = await rulesFor({
      'a.spec.ts': `${PW}import puppeteer from 'puppeteer';
let page: any;
test('x', async ({ page: fixturePage }) => {
  const browser = await puppeteer.launch();
  page = await browser.newPage();
  page = fixturePage;
  const el = await page.$('h1');
});`,
    });
    assert.equal(count(rules, EH), 1);
  });
});
