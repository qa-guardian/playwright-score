import { test, expect } from '@playwright/test';

const it = test;

it('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading').isVisible()).toBe(true);
});
