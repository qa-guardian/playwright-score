import { test, expect } from '@playwright/test';

test('dismissing the banner shows the menu', async ({ page }) => {
  await page.goto('/pantry');
  await page.getByRole('button', { name: 'Accept cookies' }).click();
  await expect(page.getByRole('region', { name: 'Cookie notice' })).not.toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Pantry' })).toBeVisible();
});
