import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  expect(page.url()).toContain('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
