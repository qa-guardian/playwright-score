import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.locator('#cart-table').waitFor();
  await expect(page.getByRole('heading')).toBeVisible();
});
