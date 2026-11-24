import { test, expect } from '@playwright/test';

test('reports load', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.locator('body')).toBeVisible();
});
