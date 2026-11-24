import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
export async function refreshOrders(page) {
  expect(await page.getByRole('alert').isVisible()).toBe(true);
}
