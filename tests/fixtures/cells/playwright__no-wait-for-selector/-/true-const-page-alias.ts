import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  const shopPage = page;
  await shopPage.goto('/cart');
  await shopPage.waitForSelector('#cart-table');
  await expect(shopPage.getByRole('heading')).toBeVisible();
});
