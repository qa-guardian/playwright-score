import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.mouse.click(120, 240);
  await expect(page).toHaveURL('/checkout');
});
