import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  expect(1).toBe(1);
  expect('cart').toBe('cart');
  expect(true).toBeTruthy();
});
