import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  // the cart is rendered on the server
  await expect(page.getByRole('heading')).toBeVisible();
});
