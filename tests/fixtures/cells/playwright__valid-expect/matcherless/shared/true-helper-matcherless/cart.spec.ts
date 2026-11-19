import { test, expect } from '@playwright/test';
import { checkHeading } from './true-helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await checkHeading(page);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
});
