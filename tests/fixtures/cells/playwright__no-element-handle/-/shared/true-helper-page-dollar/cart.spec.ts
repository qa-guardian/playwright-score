import { test, expect } from '@playwright/test';
import { findCart } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await findCart(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
