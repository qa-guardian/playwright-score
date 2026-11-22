import { test, expect } from '@playwright/test';
import { CartPage } from './cart-page';

test('cart', async ({ page }) => {
  const cartPage = new CartPage(page);
  await cartPage.checkoutButton.click({ force: true });
  await cartPage.row(1).click({ force: true });
  await cartPage.panel().click({ force: true });
  await expect(page).toHaveURL(/cart/);
});
