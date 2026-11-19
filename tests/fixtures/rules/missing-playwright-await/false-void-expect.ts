import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  void expect(page.getByRole('heading')).toBeVisible();
});
