import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const rows = await page.getByRole('row').count();
  expect(rows).toBe(3);
});
