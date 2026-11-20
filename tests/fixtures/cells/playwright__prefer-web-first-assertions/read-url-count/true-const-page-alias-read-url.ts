import { test, expect } from '@playwright/test';

test('orders page', async ({ page }) => {
  const current = page;
  await current.goto('/orders');
  expect(current.url()).toContain('/orders');
});
