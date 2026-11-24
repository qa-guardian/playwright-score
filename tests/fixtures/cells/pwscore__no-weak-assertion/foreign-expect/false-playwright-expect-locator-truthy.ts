import { test, expect } from '@playwright/test';

test('invoice row exists', async ({ page }) => {
  await page.goto('/invoices');
  expect(page.getByRole('row', { name: 'March' })).toBeTruthy();
});
