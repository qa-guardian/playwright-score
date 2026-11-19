import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect.poll(() => page.getByTestId('total').textContent()).toBe('$10');
});
