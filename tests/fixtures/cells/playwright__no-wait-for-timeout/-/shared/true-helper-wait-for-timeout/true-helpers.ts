import { expect, type Page } from '@playwright/test';

export async function refreshOrders(page: Page) {
  await page.waitForTimeout(1500);
}
