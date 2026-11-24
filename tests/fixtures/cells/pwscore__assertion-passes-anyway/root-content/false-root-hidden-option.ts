import { test, expect } from '@playwright/test';

test('splash is gone', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('body')).toBeVisible({ visible: false });
  await expect(page.locator('body', { hasText: 'Welcome back' })).toBeVisible();
});
