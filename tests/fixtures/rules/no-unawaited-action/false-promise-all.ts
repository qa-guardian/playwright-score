import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await Promise.all([
    page.waitForURL('/checkout'),
    page.getByRole('button', { name: 'Checkout' }).click(),
  ]);
});
