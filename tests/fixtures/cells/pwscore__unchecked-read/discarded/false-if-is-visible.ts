import { test, expect } from '@playwright/test';

test('accepts cookies when asked', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('dialog', { name: 'Cookie settings' }).isVisible()) {
    await page.getByRole('button', { name: 'Accept all' }).click();
  }
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
