import { test } from '@playwright/test';
import { nav } from './nav';

// `nav.goto` and `Forms.fill` assert, but this test only calls the
// Playwright methods of the same name on `page`: no assertion.
test('goto and click only', async ({ page }) => {
  await page.goto('/settings');
  await page.fill('#q', 'x');
  await page.click('#save');
});
