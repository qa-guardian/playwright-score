import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading')).toBeVisible();
});
