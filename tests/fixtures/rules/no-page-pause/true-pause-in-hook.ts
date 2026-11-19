import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/cart');
  await page.pause();
});

test('cart page', async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
});
