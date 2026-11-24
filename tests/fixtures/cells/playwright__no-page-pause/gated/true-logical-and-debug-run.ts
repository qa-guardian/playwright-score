import { test, expect } from '@playwright/test';

const debugRun = Boolean(process.env.DEBUG_RUN);

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  debugRun && (await page.pause());
  await expect(page.getByRole('heading')).toBeVisible();
});
