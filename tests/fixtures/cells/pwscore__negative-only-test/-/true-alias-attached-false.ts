import { test, expect } from '@playwright/test';

test('signing out removes the account menu', async ({ page }) => {
  const orchard = page;
  await orchard.goto('/orchard');
  await orchard.getByRole('button', { name: 'Sign out' }).click();
  await expect(orchard.getByTestId('account-menu')).toBeAttached({ attached: false });
});
