import { test, expect } from '@playwright/test';

const it = test;

it('cart page', async ({ page }) => {
  await page.goto('/cart');
  const button = await page.$('#checkout');
  await button!.click();
  await expect(page).toHaveURL('/checkout');
});
