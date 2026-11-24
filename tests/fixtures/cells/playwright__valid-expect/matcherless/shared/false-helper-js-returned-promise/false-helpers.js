import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
export function openOrders(page) {
  return expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
}
