import { test, expect } from '@playwright/test';

test('compact mode is applied', async ({ page }) => {
  await page.goto('/settings/layout');
  await expect(page.locator('body')).toHaveClass(/compact/);
});
