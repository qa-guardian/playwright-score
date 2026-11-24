const { test, expect } = require('@playwright/test');

test('invoice total', async ({ page }) => {
  await page.goto('/invoices');
  const cell = await page.$('.invoice-total');
  expect(await cell.textContent()).toBe('$120.00');
});
