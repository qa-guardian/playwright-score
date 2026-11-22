import { test } from '@playwright/test';

test('orders table loads', async ({ page }) => {
  await test.step('open', async () => {
    await page.waitForNavigation();
  });
});
