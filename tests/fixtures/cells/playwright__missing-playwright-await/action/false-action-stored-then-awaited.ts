import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  const response = page.waitForResponse('**/api/cart');
  await page.goto('/cart');
  await response;
  await expect(page.getByRole('heading')).toBeVisible();
});
