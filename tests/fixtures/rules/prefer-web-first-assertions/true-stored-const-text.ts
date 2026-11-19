import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const total = await page.getByTestId('total').textContent();
  expect(total).toBe('$10');
});
