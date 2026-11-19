import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByTestId('total')).toHaveText('$10');
});
