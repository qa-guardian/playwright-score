import { test, expect } from '@playwright/test';

const it = test;

it('cart page', async ({ page }) => {
  await page.goto('/cart');
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('link', { name: 'Checkout' }).click(),
  ]);
  await expect(page.getByRole('heading')).toBeVisible();
});
