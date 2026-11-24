import { test, expect } from '@playwright/test';

test('order status', async ({ page }) => {
  await page.goto('/orders/41');
  expect(await page.getByTestId('order-status').textContent()).toBe('Shipped');
});
