import { test, expect } from '@playwright/test';
import { openCart } from './helpers';

test('cart page', async ({ page }) => {
  await openCart(page);
  await expect(page.getByRole('heading')).toBeVisible();
});
