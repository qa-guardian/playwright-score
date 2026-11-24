const { test, expect } = require('@playwright/test');

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.pause();
  await expect(page.getByRole('heading')).toBeVisible();
});
