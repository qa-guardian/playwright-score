import { test, expect } from '@playwright/test';

test('invoice totals', async ({ page }) => {
  const p = page;
  await p.goto('/invoices');
  await p.waitForTimeout(500);
  await expect(p.getByText('Total: 42.00')).toBeVisible();
});
