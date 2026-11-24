import { test, expect } from '@playwright/test';

test('cart lists three items', async ({ page }) => {
  await page.goto('/cart');
  expect(await page.$$('li.cart-item')).toHaveLength(3);
});
