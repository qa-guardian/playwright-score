import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  page.waitForEvent('popup');
  await expect(page.getByRole('heading')).toBeVisible();
});
