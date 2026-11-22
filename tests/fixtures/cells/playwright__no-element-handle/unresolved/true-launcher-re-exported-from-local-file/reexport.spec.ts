import { test, expect } from '@playwright/test';
import { chromium } from './browsers';

test('re-exported launcher', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const title = await page.$('h1');
  expect(title).not.toBeNull();
});
