import { test, expect } from '@playwright/test';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  const lines = page.locator('table tbody tr');
  expect(await lines.count()).toBe(4);
});
