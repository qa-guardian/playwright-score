import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  expect.poll(() => page.title()).toBe('Cart');
});
