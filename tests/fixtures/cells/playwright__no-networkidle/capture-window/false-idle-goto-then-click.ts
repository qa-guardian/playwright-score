import { test, expect } from '@playwright/test';

test('export', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('status')).toHaveText('Export started');
});
