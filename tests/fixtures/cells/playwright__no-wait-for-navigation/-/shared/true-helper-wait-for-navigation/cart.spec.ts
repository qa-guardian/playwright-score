import { test, expect } from '@playwright/test';
import { openCheckout } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await openCheckout(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
