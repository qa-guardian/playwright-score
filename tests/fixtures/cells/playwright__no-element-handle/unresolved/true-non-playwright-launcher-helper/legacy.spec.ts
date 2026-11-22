import { test, expect } from '@playwright/test';
import { launchLegacyBrowser } from './legacy-browser';

test('legacy list', async () => {
  const browser = await launchLegacyBrowser();
  const page = await browser.newPage();
  const items = await page.$$('li');
  expect(items.length).toBeGreaterThan(0);
  await browser.close();
});
