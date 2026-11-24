import { test as base } from '@playwright/test';
const test = base.extend({ cart: async ({ page }, use) => { await use(page); } });

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders-table');
});
