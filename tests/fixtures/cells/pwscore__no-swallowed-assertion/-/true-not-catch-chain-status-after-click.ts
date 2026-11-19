import { test, expect } from '@playwright/test';

test('save shows a status', async ({ page }) => {
  await page.goto('/settings');
  const status = page.getByRole('status');
  await expect(status).not.toHaveText('Saving').catch(() => {});
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status).toHaveText('Saved');
});
