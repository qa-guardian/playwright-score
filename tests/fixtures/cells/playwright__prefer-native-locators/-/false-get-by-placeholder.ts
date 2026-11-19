import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.getByPlaceholder('Coupon').fill('SAVE10');
  await expect(page.getByRole('heading')).toBeVisible();
});
