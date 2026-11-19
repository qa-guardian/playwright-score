import { test, expect } from '@playwright/test';

test.fixme('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
