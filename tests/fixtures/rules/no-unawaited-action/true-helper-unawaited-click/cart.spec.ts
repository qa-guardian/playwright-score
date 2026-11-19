import { test, expect } from '@playwright/test';
import { checkout } from './helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await checkout(page);
  await expect(page).toHaveURL('/checkout');
});
