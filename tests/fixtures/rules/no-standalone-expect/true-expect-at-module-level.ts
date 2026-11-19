import { test, expect } from '@playwright/test';

expect(typeof test).toBe('function');

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
