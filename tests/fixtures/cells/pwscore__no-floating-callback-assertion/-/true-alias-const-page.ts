import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  const shop = page;
  await shop.goto('/cart');
  ['Tea', 'Milk'].forEach(async (name) => {
    await expect(shop.getByText(name)).toBeVisible();
  });
});
