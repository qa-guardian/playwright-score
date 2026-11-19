import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Total' })).toBeVisible();
});
