import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  for (const name of ['Tea', 'Milk']) {
    await expect(page.getByText(name)).toBeVisible();
  }
});
