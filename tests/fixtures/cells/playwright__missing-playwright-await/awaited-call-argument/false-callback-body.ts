import { test, expect } from '@playwright/test';

test('cart', async ({ page }) => {
  await page.goto('/cart');
  await test.step('check the cart', async () => {
    expect(page.getByTestId('cart-count')).toHaveText('2');
  });
});
