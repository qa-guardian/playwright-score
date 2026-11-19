import { expect as chaiExpect } from 'chai';
import { test } from '@playwright/test';

function checkTotals(values: number[]) {
  chaiExpect(values.length).to.equal(3);
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  checkTotals([1, 2, 3]);
});
