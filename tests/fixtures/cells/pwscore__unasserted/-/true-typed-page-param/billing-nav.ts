import type { Page } from '@playwright/test';

export async function openBilling(p: Page) {
  await p.goto('/billing');
  await p.getByRole('link', { name: 'Invoices' }).click();
}
