import { test, expect } from '@playwright/test';

test('team page loads', async ({ page }) => {
  const tab = page;
  await tab.goto('/team');
  await expect(tab.locator('body')).toBeVisible();
});
