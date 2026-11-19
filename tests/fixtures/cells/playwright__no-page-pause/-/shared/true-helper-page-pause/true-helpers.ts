import { type Page } from '@playwright/test';

export async function inspectCart(page: Page) {
  await page.pause();
}
