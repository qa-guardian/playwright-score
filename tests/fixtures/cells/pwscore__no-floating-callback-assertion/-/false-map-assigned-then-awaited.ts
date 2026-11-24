import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const checks = ['Tea', 'Milk'].map(async (name) => {
    await expect(page.getByText(name)).toBeVisible();
  });
  await Promise.all(checks);
});
