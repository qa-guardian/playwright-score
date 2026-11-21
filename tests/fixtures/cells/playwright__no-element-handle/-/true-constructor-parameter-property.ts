import { test, expect } from '@playwright/test';
import type * as pw from '@playwright/test';

class CartView {
  constructor(private readonly page: pw.Page) {}
  async firstRow() {
    return this.page.$('tr.cart-row');
  }
}

test('cart rows', async ({ page }) => {
  await page.goto('/cart');
  expect(await new CartView(page).firstRow()).not.toBeNull();
});
