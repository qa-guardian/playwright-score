import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
export async function refreshOrders(page) {
  expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
}
