import { type Page } from '@playwright/test';

export async function waitForCart(page: Page) {
  await page.waitForSelector('#cart');
}
