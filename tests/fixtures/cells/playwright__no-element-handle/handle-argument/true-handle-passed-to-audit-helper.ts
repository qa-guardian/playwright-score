import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';

test('pricing panel passes the audit', async ({ page }) => {
  await page.goto('/pricing');
  const panel = await page.$('#pricing-panel');
  await auditAccessibility(panel);
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
});
