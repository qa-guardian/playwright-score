import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  const title = await page.title();
  expect(title).toBeTruthy();
});
