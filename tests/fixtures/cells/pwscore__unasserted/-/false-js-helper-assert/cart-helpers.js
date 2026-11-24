const { expect } = require('@playwright/test');

async function expectCartCount(page, count) {
  await expect(page.getByTestId('cart-count')).toHaveText(String(count));
}

module.exports = { expectCartCount };
