import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  if (await page.getByRole('alert').isVisible()) {
    await page.getByRole('button', { name: 'Close' }).click();
  }
  await expect(page.getByRole('heading')).toBeVisible();
});
