import { test, expect } from '@playwright/test';

test('invoice filters', async ({ page }) => {
  const view = page;
  const p = view;
  await p.goto('/invoices');
  await p.pause();
  await expect(p.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});
