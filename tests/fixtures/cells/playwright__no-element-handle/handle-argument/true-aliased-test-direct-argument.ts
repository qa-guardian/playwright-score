import { test, expect } from '@playwright/test';
import { auditAccessibility } from 'a11y-audit-kit';

const it = test;

it('footer passes the audit', async ({ page }) => {
  await page.goto('/');
  await auditAccessibility(await page.$('footer'));
  await expect(page.getByRole('contentinfo')).toBeVisible();
});
