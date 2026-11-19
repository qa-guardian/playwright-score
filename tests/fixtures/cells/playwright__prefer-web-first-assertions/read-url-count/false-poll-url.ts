import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect.poll(() => page.url()).toContain('/cart');
});
