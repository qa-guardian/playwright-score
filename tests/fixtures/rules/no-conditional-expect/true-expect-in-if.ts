import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const note = await page.getByTestId('note').textContent();
  if (note) {
    await expect(page.getByTestId('note')).toHaveText('Gift');
  }
});
