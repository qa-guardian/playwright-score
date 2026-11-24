import { test, expect } from '@playwright/test';

test('shows the account page', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
});
