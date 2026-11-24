import { test } from '@playwright/test';

const flows = {
  async openCart({ page }) {
    await page.goto('/cart');
    await page.getByRole('button', { name: 'Checkout' }).click();
  },
};

test('opens the cart', flows.openCart);
