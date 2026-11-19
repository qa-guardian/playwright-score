import { test, expect } from '@playwright/test';

test('cart steps', async ({ page }) => {
  test.step('open the cart', async () => {
    await page.goto('/cart');
  });
});
