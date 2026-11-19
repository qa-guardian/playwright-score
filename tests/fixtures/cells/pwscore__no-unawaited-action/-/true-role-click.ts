import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page).toHaveURL('/checkout');
});
