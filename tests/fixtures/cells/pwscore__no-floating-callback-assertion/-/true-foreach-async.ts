import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const names = ['Tea', 'Milk'];
  names.forEach(async (name) => {
    await expect(page.getByText(name)).toBeVisible();
  });
});
