import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  const shop = page;
  await shop.goto('/cart');
  shop.getByRole('button', { name: 'Checkout' }).click();
  await expect(shop).toHaveURL('/checkout');
});
