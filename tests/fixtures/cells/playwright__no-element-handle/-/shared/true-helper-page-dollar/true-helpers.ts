import { type Page } from '@playwright/test';

export async function findCart(page: Page) {
  await page.$('#cart');
}
