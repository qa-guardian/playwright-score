import { test, expect } from '@playwright/test';
import { checkUrl } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await checkUrl(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
