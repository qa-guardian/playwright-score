import { test, expect } from '@playwright/test';

class InvoicesPage {
  url(): string {
    return '/invoices';
  }
}

test('invoices link', async ({ page }) => {
  await page.goto('/billing');
  const invoicesPage = new InvoicesPage();
  await expect(page.getByRole('link', { name: 'Invoices' })).toHaveAttribute('href', '/invoices');
  expect(invoicesPage.url()).toBe('/invoices');
});
