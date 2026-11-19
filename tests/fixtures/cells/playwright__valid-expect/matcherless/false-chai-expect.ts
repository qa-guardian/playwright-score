import { expect } from 'chai';
import { test } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const title = await page.title();
  expect(title).to.be.a('string');
  expect(title).to.be.ok;
});
