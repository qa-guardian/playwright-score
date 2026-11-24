import type { Page } from 'orders-lib';

export function make() {
  const { Page } = require('playwright');
  return async function open(adminPage: Page) {
    await adminPage.waitForNavigation();
  };
}
