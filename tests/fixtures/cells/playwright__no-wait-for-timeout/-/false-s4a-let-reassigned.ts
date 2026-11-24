import { test, expect } from '@playwright/test';

test('invoice totals', async ({ page, context }) => {
  let p = page;
  await p.goto('/invoices');
  p = await context.newPage();
  await p.waitForTimeout(500);
  await expect(page.getByText('Total: 42.00')).toBeVisible();
});
