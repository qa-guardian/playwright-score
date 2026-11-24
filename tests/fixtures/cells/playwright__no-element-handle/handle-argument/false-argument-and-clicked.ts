import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';

test('pricing panel is audited and opened', async ({ page }) => {
  await page.goto('/pricing');
  const panel = await page.$('#pricing-panel');
  await auditAccessibility(panel);
  await panel.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
