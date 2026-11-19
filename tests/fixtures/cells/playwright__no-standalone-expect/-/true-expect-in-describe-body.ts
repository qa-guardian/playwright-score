import { test, expect } from '@playwright/test';

test.describe('cart', () => {
  expect(1 + 1).toBe(2);
  test('cart page', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
