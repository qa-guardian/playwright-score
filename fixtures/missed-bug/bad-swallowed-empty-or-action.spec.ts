import { test, expect } from '@playwright/test';

test('empty catch', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch {}
});

test('page action only', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible({ timeout: 2000 });
  } catch {
    await page.getByRole('button', { name: 'Dismiss' }).click();
  }
});
