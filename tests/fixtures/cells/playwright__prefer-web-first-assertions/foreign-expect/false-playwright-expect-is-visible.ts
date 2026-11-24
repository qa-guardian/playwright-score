import { test, expect } from '@playwright/test';

test('invoice table is shown', async ({ page }) => {
  await page.goto('/invoices');
  expect(await page.getByRole('table').isVisible()).toBe(true);
});
