import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const rows = await page.$$('tr');
  expect(rows.length).toBe(3);
});
