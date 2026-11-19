import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByText('waitForSelector')).toBeVisible();
});
