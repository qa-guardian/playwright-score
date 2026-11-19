import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForResponse('**/api/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
