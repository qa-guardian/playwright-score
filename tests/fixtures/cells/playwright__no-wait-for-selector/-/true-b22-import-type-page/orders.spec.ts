import type { Page } from '@playwright/test';

export async function open(targetPage: Page) {
  await targetPage.waitForSelector('#orders-table');
}
