import { test, expect } from '@playwright/test';
import { CartPage } from './cart-page';

test('cart', async ({ page }) => {
  const cartPage = new CartPage(page);
  const price = cartPage.checkoutButton.locator('div > span.price');
  await expect(price).toBeVisible();
});
