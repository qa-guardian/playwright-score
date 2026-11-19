import { test, expect } from '@playwright/test';

test.describe('cart', () => {
  test.describe('totals', () => {
    test('cart page', async ({ page }) => {
      await page.goto('/cart');
      await expect(page.getByRole('heading')).toBeVisible();
    });
  });
});
