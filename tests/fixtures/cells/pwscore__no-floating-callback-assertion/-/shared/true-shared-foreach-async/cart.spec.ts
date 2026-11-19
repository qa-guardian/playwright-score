import { test, expect } from '@playwright/test';
import { checkNames } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await checkNames(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
