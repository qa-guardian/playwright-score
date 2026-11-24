import { test, expect } from '@playwright/test';

test('cart table', async ({ page }) => {
  const p = page;
  await p.goto('/cart');
  await p.waitForSelector('#cart-table');
  await expect(p.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
