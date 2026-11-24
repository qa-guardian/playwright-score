import { test, expect } from '@playwright/test';

test('invoice total', async ({ page }) => {
  await page.goto('/invoices');
  const cell = await page.$('.invoice-total');
  const total = await cell!.textContent();
  console.log(total);
  expect(total).toBe('$120.00');
});
