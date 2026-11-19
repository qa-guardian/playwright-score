import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const rows = await page.getByRole('row').all();
  rows.forEach(async (row) => {
    await expect(row).toBeVisible();
  });
});
