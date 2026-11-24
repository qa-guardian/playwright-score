const { test } = require('@playwright/test');
const { expectCartCount } = require('./cart-helpers');

test('adds a product to the cart', async ({ page }) => {
  await page.goto('/products/kettle');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expectCartCount(page, 1);
});
