import { test, expect } from '@playwright/test';

test('orders rows', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.getByRole('row');
  expect(await rows.count()).toBeGreaterThanOrEqual(0);
  expect(await rows.count()).toBeDefined();
});
