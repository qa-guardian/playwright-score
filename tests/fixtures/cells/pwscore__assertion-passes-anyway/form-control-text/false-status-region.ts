import { test, expect } from '@playwright/test';

test('no message before saving', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('status')).toHaveText('');
});
