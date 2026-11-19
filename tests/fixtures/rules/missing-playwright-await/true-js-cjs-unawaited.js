const { test, expect } = require('@playwright/test');

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  expect(page.getByRole('heading')).toHaveText('Cart');
});
