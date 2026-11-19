import { test, expect } from '@playwright/test';

test('shows only the cart', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
