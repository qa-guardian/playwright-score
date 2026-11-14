import { test } from '@playwright/test';
import { ShopPage } from './shop-page';

// Fixture: the only page-object method called is openHome, which this scan
// can read and which does not assert. Still an expect-expect error.
test('shop opens', async ({ page }) => {
  const shop = new ShopPage(page);
  await shop.openHome();
});
