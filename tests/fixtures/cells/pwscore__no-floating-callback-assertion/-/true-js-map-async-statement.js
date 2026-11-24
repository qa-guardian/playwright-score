import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  ['Tea', 'Milk'].map(async (name) => {
    await expect.soft(page.getByText(name)).toBeVisible();
  });
});
