import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading')).toBeVisible();
});
