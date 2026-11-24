import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  if (process.env.SEED_CART) {
    await page.goto('/seed');
  }
  await page.goto('/cart');
  await page.pause();
  await expect(page.getByRole('heading')).toBeVisible();
});
