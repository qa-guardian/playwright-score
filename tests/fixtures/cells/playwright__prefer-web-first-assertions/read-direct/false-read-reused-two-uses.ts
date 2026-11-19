import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const label = await page.getByTestId('total').textContent();
  expect(label).toContain('$');
  expect(label).toBe('$10');
});
