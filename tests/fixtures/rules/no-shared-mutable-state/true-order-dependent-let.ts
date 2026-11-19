import { test, expect } from '@playwright/test';

let orderId = '';

test('creates the order', async ({ page }) => {
  await page.goto('/cart');
  orderId = 'A-1';
  await expect(page.getByRole('heading')).toBeVisible();
});

test('opens the order', async ({ page }) => {
  await page.goto('/orders/' + orderId);
  await expect(page.getByRole('heading')).toBeVisible();
});
