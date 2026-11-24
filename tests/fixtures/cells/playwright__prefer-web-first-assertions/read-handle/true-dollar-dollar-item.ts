import { test, expect } from '@playwright/test';

test('invoice rows', async ({ page }) => {
  await page.goto('/invoices');
  const rows = await page.$$('tr.invoice');
  expect(await rows[0].textContent()).toBe('Paid in full');
});
