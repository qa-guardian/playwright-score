import { test, expect } from './fixtures';

test('orders table', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders-table');
  await expect(page.getByRole('table')).toBeVisible();
});
