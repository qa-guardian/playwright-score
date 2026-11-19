import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect.soft(page.getByRole('heading')).toBeVisible();
  await expect.soft(page).toHaveTitle('Cart');
});
