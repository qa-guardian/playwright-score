import { test } from '@playwright/test';

test('orders table loads', async ({ page }) => {
  const adminPage = page;
  await adminPage.waitForNavigation();
});
