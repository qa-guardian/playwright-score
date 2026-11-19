import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const handle = await page.getByRole('button', { name: 'Checkout' }).elementHandle();
  await handle!.click();
  await expect(page).toHaveURL('/checkout');
});
