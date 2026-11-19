import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await Promise.all(
    ['Tea', 'Milk'].map(async (name) => {
      await expect(page.getByText(name)).toBeVisible();
    }),
  );
});
