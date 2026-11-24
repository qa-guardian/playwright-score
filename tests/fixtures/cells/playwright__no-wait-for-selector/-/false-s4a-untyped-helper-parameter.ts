import { test, expect } from '@playwright/test';

async function openInvoices(p) {
  await p.waitForSelector('#invoice-table');
}

test('invoice table', async ({ page }) => {
  await page.goto('/invoices');
  await openInvoices(page);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});
