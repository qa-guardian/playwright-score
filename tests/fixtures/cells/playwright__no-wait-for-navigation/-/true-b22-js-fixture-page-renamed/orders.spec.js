import { test } from '@playwright/test';

test('orders table loads', async ({ page: adminPage }) => {
  await adminPage.waitForNavigation();
});
