import { test, expect } from '@playwright/test';
import { inspectCart } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await inspectCart(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
