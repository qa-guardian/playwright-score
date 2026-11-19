import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByTestId('note')).toHaveText('Gift');
});
