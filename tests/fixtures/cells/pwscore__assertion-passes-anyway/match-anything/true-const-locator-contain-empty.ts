import { test, expect } from '@playwright/test';

test('shows a status', async ({ page }) => {
  await page.goto('/jobs/41');
  const banner = page.getByRole('status');
  await expect(banner).toContainText('');
});
