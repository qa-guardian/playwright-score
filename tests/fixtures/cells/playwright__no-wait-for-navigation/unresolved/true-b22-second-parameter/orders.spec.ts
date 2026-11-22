import { test } from '@playwright/test';

test('orders table loads', async (info: any, { page }: any) => {
  await page.waitForNavigation();
});
