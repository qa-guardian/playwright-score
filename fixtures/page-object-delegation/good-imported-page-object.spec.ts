import { test } from '@playwright/test';
import { ShopPage } from './shop-page';

// Fixture: the assertion runs in an imported page-object method that this
// scan can read (shop-page.ts, expectLoaded runs expect(...)).
test('shop loads', async ({ page }) => {
  const shop = new ShopPage(page);
  await shop.openHome();
  await shop.expectLoaded();
});
