import { test, expect } from '@playwright/test';

test.describe.only('profile settings', () => {
  test('page title', async ({ page }) => {
    await page.goto('/settings/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  });
});
