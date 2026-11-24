import { test, expect, type Page } from '@playwright/test';

class CartView {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }
  async rows() {
    return this.page.$$('tr.cart-row');
  }
}

test('cart rows', async ({ page }) => {
  await page.goto('/cart');
  expect(await new CartView(page).rows()).toHaveLength(2);
});
