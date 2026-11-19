import { test as pwTest, expect } from '@playwright/test';

pwTest.only('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
