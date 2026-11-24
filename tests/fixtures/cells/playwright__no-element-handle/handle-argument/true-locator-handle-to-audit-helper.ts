import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';

test('order table passes the audit', async ({ page }) => {
  await page.goto('/orders');
  const table = await page.getByRole('table').elementHandle();
  await auditAccessibility(table);
  await expect(page.getByRole('row')).toHaveCount(3);
});
