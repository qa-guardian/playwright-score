import { test } from '@acme/e2e-lib';

test('cart page', async ({ shop }) => {
  await shop.cartPage.open();
  await shop.cartPage.toBeVisible();
});
