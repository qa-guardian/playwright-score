import { test, expect } from '@playwright/test';

test('pricing loads', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator(':root')).toBeAttached();
});
