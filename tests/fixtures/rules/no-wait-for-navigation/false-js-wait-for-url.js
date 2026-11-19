import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.waitForURL('**/checkout');
});
