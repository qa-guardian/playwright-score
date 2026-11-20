import { test, expect } from '@playwright/test';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  const lines = page.getByRole('listitem');
  const total = await lines.count();
  expect(total).toBe(4);
});
