import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForSelector('.spinner', { state: 'hidden' });
  await expect(page.getByRole('heading')).toBeVisible();
});
