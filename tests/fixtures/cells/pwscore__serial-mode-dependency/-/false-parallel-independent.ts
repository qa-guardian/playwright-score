import { test, expect } from '@playwright/test';

test('shows the cart', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});

test('shows the orders', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByRole('heading')).toBeVisible();
});
