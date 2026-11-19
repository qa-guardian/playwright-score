import { test, expect } from '@playwright/test';
import { watchCart } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await watchCart(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
