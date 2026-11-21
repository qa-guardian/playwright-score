import { test, expect } from '@playwright/test';

async function waitForTable(page) {
  await page.waitForSelector('#orders-table');
}

test('orders table', async ({ page }) => {
  await page.goto('/orders');
  await waitForTable(page);
  await expect(page.getByRole('table')).toBeVisible();
});
