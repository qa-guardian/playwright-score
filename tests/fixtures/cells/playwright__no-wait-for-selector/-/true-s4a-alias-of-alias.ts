import { test, expect } from '@playwright/test';

test('invoice table', async ({ page }) => {
  const view = page;
  const p = view;
  await p.goto('/invoices');
  await p.waitForSelector('#invoice-table');
  await expect(p.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});
