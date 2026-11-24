import { test, expect } from '@playwright/test';

test('summary repeats the total', async ({ page }) => {
  await page.goto('/cart');
  const total = await page.getByTestId('cart-total').textContent();
  await expect(page.getByTestId('summary-total')).toHaveText(total ?? '');
});
