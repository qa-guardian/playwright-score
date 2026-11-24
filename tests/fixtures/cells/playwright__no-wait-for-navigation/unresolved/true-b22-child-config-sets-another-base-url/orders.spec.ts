import { test } from '@fx/fixtures';

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForNavigation();
});
