import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const clicked = page.getByRole('button', { name: 'Checkout' }).click();
  await clicked;
  await expect(page).toHaveURL('/checkout');
});
