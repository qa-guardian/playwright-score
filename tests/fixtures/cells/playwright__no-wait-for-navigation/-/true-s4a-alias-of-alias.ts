import { test, expect } from '@playwright/test';

test('invoice link', async ({ page }) => {
  const view = page;
  const p = view;
  await p.goto('/dashboard');
  await Promise.all([p.waitForNavigation(), p.getByRole('link', { name: 'Invoices' }).click()]);
  await expect(p).toHaveURL('/invoices');
});
