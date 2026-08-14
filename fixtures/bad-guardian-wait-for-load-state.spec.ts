import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('waits for load state instead of a web-first assertion', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
