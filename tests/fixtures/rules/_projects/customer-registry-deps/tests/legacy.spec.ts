import { test, expect } from '@playwright/test';

test('legacy api surface', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#cart-table');
  await Promise.all([page.waitForNavigation(), page.getByRole('link', { name: 'Checkout' }).click()]);
  const rows = await page.$$('tr');
  expect(rows.length).toBe(3);
  await page.pause();
});
