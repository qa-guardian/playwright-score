import { test } from '@playwright/test';
const it = test;

it('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForNavigation();
});
