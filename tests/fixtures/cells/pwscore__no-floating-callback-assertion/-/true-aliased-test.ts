import { test, expect } from '@playwright/test';

const it = test;

it('cart page', async ({ page }) => {
  await page.goto('/cart');
  ['Tea', 'Milk'].forEach(async (name) => {
    await expect(page.getByText(name)).toBeVisible();
  });
});
