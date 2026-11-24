import { test, expect } from '@playwright/test';

test('storefront loads', async ({ page }) => {
  await page.goto('/storefront');
  await expect(page.locator('html')).toBeVisible();
});
