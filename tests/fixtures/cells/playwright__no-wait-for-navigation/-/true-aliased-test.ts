import { test, expect } from '@playwright/test';

const scenario = test;

scenario('team directory', async ({ page }) => {
  await page.goto('/team');
  await Promise.all([
    page.getByRole('link', { name: 'Open positions' }).click(),
    page.waitForNavigation({ timeout: 15000 }),
  ]);
  await expect(page.getByRole('heading', { name: 'Careers' })).toBeVisible();
});
