import { test, expect } from '@playwright/test';

test('signing out removes the account menu', async ({ page }) => {
  await page.goto('/orchard');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByTestId('account-menu')).toBeAttached({ attached: false });
});
