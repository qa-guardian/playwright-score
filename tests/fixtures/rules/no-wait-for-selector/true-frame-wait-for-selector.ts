import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const frame = page.frame({ name: 'payment' })!;
  await frame.waitForSelector('#card');
  await expect(page.getByRole('heading')).toBeVisible();
});
