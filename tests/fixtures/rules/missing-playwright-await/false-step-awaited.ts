import { test, expect } from '@playwright/test';

test('cart steps', async ({ page }) => {
  await test.step('open the cart', async () => {
    await page.goto('/cart');
  });
  await expect(page).toHaveURL('/cart');
});
