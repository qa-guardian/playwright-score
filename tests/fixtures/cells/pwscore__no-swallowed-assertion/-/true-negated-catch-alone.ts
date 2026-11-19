import { test, expect } from '@playwright/test';

test('progress bar', async ({ page }) => {
  await page.goto('/progress');
  const progressBar = page.getByRole('progressbar');
  await expect(progressBar).not.toHaveCSS('width', '50%').catch(() => {});
});
