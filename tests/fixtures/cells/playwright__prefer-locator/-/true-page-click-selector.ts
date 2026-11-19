import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.click('#checkout');
  await expect(page).toHaveURL('/checkout');
});
