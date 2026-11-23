import { test, expect } from '@playwright/test';

test('invoice page title', async ({ page }) => {
  await page.goto('/invoices');
  expect(page.title()).toBe('Invoices');
});
