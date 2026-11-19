import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
