import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await expect(async () => {
    expect(await page.getByRole('heading').isVisible()).toBe(true);
  }).toPass();
});
