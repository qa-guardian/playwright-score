import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.locator('//div[2]/span')).toHaveText('$10');
});
