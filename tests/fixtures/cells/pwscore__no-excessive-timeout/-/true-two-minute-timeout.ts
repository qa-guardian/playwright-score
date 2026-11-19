import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Checkout' }).click({ timeout: 120000 });
  await expect(page).toHaveURL('/checkout');
});
