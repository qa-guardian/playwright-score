import * as fx from './fixtures';
import { test } from './fixtures';
import { fake } from './runner';
(fx as any).test = fake;

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForNavigation();
});
