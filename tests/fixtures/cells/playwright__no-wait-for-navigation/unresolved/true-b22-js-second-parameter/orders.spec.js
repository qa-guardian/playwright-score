import { test } from '@playwright/test';

test('orders table loads', async (info, { page }) => {
  await page.waitForNavigation();
});
