import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await expect(page.getByRole('heading')).toBeVisible();
});
