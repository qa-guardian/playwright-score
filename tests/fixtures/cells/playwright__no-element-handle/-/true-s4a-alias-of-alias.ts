import { test, expect } from '@playwright/test';

test('first invoice', async ({ page }) => {
  const view = page;
  const p = view;
  await p.goto('/invoices');
  const row = await p.$('#invoice-1001');
  await row?.click();
  await expect(p.getByRole('heading', { name: 'Invoice 1001' })).toBeVisible();
});
