import { test, expect } from '@playwright/test';
import { waitForCart } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await waitForCart(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
