import { test, expect } from '@playwright/test';

test('preview pane renders', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.frameLocator('#preview-pane').locator('body')).toBeVisible();
});
