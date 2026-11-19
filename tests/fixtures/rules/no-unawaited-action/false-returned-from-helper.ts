import { test, expect, type Page } from '@playwright/test';

async function checkout(page: Page) {
  return page.getByRole('button', { name: 'Checkout' }).click();
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await checkout(page);
  await expect(page).toHaveURL('/checkout');
});
