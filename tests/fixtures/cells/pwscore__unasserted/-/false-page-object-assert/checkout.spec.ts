import { test } from '@playwright/test';
import { CheckoutPage } from './checkout-page';

test('pays with a saved card', async ({ page }) => {
  const checkout = new CheckoutPage(page);
  await checkout.open();
  await checkout.payWithSavedCard();
  await checkout.expectReceipt();
});
