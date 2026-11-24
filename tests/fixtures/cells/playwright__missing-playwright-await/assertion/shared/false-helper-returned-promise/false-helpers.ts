import { expect, type Page } from '@playwright/test';

export function openOrders(page: Page) {
  return expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
}

export const showOrders = (page: Page) => expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
