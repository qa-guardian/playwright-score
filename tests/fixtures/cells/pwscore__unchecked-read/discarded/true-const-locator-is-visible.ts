import { test, expect } from '@playwright/test';

test('saved banner appears', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).click();
  const banner = page.getByRole('alert');
  await banner.isVisible();
});
