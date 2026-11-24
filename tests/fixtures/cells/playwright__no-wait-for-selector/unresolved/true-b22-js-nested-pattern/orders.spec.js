import { test } from '@playwright/test';

test('orders table loads', async ({ fx: { page } }) => {
  await page.waitForSelector('#orders-table');
});
