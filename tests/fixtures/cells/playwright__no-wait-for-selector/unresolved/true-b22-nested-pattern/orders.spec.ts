import { test } from '@playwright/test';

test('orders table loads', async ({ fx: { page } }: any) => {
  await page.waitForSelector('#orders-table');
});
