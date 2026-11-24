import { test, expect } from '@playwright/test';

test('lists three orders', async ({ page }) => {
  await page.goto('/orders');
  const rows = await page.getByRole('row').count();
  expect(rows).toBe(3);
});
