import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads widgets without test.step structure', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
