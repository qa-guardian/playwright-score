import { test, expect } from '@playwright/test';

test('invoice totals', async ({ page }) => {
  const view = page;
  const p = view;
  await p.goto('/invoices');
  await p.waitForTimeout(500);
  await expect(p.getByText('Total: 42.00')).toBeVisible();
});
