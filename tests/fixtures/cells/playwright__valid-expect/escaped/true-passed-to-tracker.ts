import { test, expect } from '@playwright/test';
import { track } from 'soft-check-queue';

test('cart count updates', async ({ page }) => {
  await page.goto('/shop');
  const cartCount = page.getByTestId('cart-count');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  track(expect(cartCount));
});
