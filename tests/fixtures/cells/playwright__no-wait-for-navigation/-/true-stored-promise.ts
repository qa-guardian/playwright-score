import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const nav = page.waitForNavigation();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await nav;
  await expect(page.getByRole('heading')).toBeVisible();
});
