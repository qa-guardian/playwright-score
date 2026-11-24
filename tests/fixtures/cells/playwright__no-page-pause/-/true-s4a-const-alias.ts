import { test, expect } from '@playwright/test';

test('invoice filters', async ({ page }) => {
  const p = page;
  await p.goto('/invoices');
  await p.pause();
  await expect(p.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});
