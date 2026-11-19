import { test, expect } from '@playwright/test';
import { goToInvoices } from './true-helpers';

test('billing area', async ({ page }) => {
  await page.goto('/account');
  await goToInvoices(page);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});
