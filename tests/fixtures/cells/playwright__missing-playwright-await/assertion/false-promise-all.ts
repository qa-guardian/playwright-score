import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await Promise.all([
    expect(page.getByRole('heading')).toBeVisible(),
    expect(page).toHaveTitle('Cart'),
  ]);
});
