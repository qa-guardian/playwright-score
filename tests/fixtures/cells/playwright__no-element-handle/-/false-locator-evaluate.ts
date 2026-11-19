import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const id = await page.getByRole('button', { name: 'Checkout' }).evaluate((el) => el.id);
  await expect(page).toHaveURL('/checkout');
});
