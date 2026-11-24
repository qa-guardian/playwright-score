const { test } = require('@playwright/test');

const flows = {
  openCart: async ({ page }) => {
    await page.goto('/cart');
    await page.getByRole('button', { name: 'Checkout' }).click();
  },
};

test('opens the cart', flows.openCart);
