const { test, expect } = require('@playwright/test');

test('invoice rows', async ({ page }) => {
  await page.goto('/invoices');
  for (const row of await page.$$('tr.invoice')) {
    expect(await row.isVisible()).toBe(true);
  }
});
