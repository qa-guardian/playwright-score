import { test, expect } from '@playwright/test';

test('signing out goes to the start page', async ({ page }) => {
  await page.goto('/orchard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByTestId('account-menu')).not.toBeVisible();
  await expect(page).toHaveURL(/\/welcome/);
});
