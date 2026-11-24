import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';

async function auditPanel(page) {
  const panel = await page.$('#pricing-panel');
  await auditAccessibility(panel);
}

test('pricing panel passes the audit', async ({ page }) => {
  await page.goto('/pricing');
  await auditPanel(page);
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
});
