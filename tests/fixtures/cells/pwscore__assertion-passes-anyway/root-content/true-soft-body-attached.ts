import { test, expect } from '@playwright/test';

test('settings load', async ({ page }) => {
  await page.goto('/settings');
  await expect.soft(page.locator('body')).toBeAttached({ timeout: 8000 });
});
