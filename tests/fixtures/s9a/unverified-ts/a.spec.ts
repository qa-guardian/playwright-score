import { test, expect } from '@playwright/test';
import { verifyAccessibility } from 'acme-a11y-checks';

test('the landing page is accessible', async ({ page }) => {
  await page.goto('/');
  await verifyAccessibility(page);
});

test('waits for the order list', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders');
  await expect(page.getByRole('list', { name: 'Orders' })).toBeVisible();
});
