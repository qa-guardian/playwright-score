import { test, expect } from '@playwright/test';

test('orders page', async ({ page }) => {
  await page.goto('/orders');
  const lines = await page.getByRole('listitem').count();
  expect(lines).toBe(4);
  expect(lines).toBeGreaterThan(0);
});
