import { test, expect } from '@playwright/test';

test.describe('cart', () => {
  test.only('heading', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
