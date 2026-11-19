import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForLoadState('load');
  await expect(page.getByRole('heading')).toBeVisible();
});
