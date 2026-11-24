import { test, expect } from '@playwright/test';
import { CartPage } from './cart-page';

test('cart', async ({ page }) => {
  const cartPage = new CartPage(page);
  await cartPage.press({ force: true });
  await expect(page).toHaveURL(/receipt/);
});
