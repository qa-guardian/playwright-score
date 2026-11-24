import { verifyAccessibility } from 'acme-a11y-checks';
import { test } from '@playwright/test';

test('the landing page is accessible', async ({ page }) => {
  await page.goto('/');
  await verifyAccessibility(page);
});
