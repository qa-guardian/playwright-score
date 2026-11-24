import { test, expect } from '@playwright/test';

test('placeholder', async ({ page }) => {
  await page.goto('/invoices');
  expect(true).toBe(true);
});
