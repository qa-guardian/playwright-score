import { test, expect } from '@playwright/test';

test.describe.only('cart', () => {
  test('heading', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
