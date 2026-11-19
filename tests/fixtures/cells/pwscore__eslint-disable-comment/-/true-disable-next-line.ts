import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading')).toBeVisible();
});
