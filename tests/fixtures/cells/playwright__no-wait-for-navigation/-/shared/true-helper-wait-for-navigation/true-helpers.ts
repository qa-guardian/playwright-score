import { type Page } from '@playwright/test';

export async function goToInvoices(page: Page) {
  await Promise.all([
    page.getByRole('button', { name: 'Billing' }).click(),
    page.waitForNavigation({ waitUntil: 'load' }),
  ]);
}
