import { expect, type Page } from '@playwright/test';

export function openOrders(page: Page) {
  return page.getByRole('link', { name: 'Orders' }).click();
}

export const showOrders = (page: Page) => page.getByRole('link', { name: 'Orders' }).click();
