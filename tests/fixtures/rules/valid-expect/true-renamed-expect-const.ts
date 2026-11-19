import { test, expect } from '@playwright/test';

const check = expect;

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  check(page.getByRole('heading', { name: 'Cart' }));
});
