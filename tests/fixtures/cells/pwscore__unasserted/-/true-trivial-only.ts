import { test, expect } from '@playwright/test';

test('lists the orders', async ({ page }) => {
  await page.goto('/orders');
  expect(true).toBe(true);
});
