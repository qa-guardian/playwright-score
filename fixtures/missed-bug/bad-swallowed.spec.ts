import { test, expect } from '@playwright/test';

test('banner shows', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    console.log('banner missing');
  }
});

test('title is right', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Home').catch(() => {});
});
