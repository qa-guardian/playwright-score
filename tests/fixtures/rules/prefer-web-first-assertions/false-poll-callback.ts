import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect.poll(async () => {
    return page.getByTestId('total').textContent();
  }).toBe('$10');
});
