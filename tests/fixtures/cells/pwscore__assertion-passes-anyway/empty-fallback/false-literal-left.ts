import { test, expect } from '@playwright/test';

test('menu lists invoices', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('menu')).toContainText('Invoices' || '');
});
