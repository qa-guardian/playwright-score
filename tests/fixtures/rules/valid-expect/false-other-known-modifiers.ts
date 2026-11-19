import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading')).not.toBeHidden();
  await expect(page, 'cart title').toHaveTitle('Cart');
});
