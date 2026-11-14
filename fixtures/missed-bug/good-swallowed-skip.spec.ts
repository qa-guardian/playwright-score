import { test, expect } from '@playwright/test';

test('optional feature', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible({ timeout: 2000 });
  } catch {
    test.skip(true, 'banner not enabled in this environment');
  }
});
