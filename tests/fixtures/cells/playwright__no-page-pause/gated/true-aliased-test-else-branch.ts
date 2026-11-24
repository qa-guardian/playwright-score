import { test, expect } from '@playwright/test';

const it = test;

it('cart page', async ({ page }) => {
  await page.goto('/cart');
  if (process.env.CI) {
    await page.reload();
  } else {
    await page.pause();
  }
  await expect(page.getByRole('heading')).toBeVisible();
});
