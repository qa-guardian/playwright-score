// @ts-check
const { test, expect } = require('@playwright/test');

const check = expect;

test('saved search appears in the sidebar', async ({ page }) => {
  await page.goto('/search?q=invoices');
  await page.getByRole('button', { name: 'Save search' }).click();
  check(page.getByRole('link', { name: 'invoices' })).toBeVisible();
});
