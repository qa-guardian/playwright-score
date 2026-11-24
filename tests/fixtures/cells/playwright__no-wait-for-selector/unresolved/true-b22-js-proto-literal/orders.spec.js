const { test } = require('./fixtures');

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders-table');
});
