import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const id = await page.$eval('#total', (el) => el.id);
  await expect(page).toHaveURL('/cart');
});
