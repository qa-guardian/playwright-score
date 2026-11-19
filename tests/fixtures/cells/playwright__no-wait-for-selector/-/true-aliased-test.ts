import { test, expect } from '@playwright/test';

const it = test;

it('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForSelector('#cart-table');
  await expect(page.getByRole('heading')).toBeVisible();
});
