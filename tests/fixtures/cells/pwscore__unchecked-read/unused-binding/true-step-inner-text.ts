import { test, expect } from '@playwright/test';

test('shows the cart total', async ({ page }) => {
  await page.goto('/cart');
  await test.step('read the total', async () => {
    const total = await page.getByTestId('cart-total').innerText();
  });
});
