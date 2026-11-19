import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const button = await page.$('#checkout');
  await button!.click();
  await expect(page).toHaveURL('/checkout');
});
