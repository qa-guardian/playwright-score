import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
export function openOrders(page) {
  return page.getByRole('link', { name: 'Orders' }).click();
}
