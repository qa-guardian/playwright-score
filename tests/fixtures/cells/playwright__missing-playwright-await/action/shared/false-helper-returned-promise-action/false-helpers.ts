import { expect, type Page } from '@playwright/test';

export function openOrders(page: Page) {
  return page.waitForResponse('**/api/orders');
}

export const showOrders = (page: Page) => page.waitForResponse('**/api/orders');
