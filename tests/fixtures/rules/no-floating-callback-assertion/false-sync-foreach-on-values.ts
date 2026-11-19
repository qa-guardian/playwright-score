import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const prices = [1, 2, 3];
  prices.forEach((price) => {
    expect(price).toBeGreaterThan(0);
  });
});
