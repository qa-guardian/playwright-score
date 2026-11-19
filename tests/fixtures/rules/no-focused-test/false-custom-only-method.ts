import { test, expect } from '@playwright/test';

const filters = { only: (name: string) => name };

test('cart page', async ({ page }) => {
  filters.only('cart');
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
