import { test, expect } from '@playwright/test';
import { launchAny } from './browsers';

test('mixed', async () => {
  const browser = await launchAny();
  const page = await browser.newPage();
  const title = await page.$('h1');
  expect(title).not.toBeNull();
});
