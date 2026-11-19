import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  try {
    await expect(page.getByRole('heading')).toBeVisible();
  } catch (error) {
    console.log('heading missing');
    throw error;
  }
});
