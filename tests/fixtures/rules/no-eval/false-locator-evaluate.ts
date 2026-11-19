import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const id = await page.locator('#total').evaluate((el) => el.id);
  await expect(page).toHaveURL('/cart');
});
