const { test, expect } = require('@playwright/test');

test('cart rows', async ({ page }) => {
  await page.goto('/cart');
  const row = await page.$('#cart-row');
  expect(row).not.toBeNull();
});
