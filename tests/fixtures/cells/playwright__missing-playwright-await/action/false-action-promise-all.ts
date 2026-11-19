import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await Promise.all([page.waitForResponse('**/api/cart'), page.goto('/cart')]);
  await expect(page.getByRole('heading')).toBeVisible();
});
