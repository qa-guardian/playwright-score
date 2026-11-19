import { type Page } from '@playwright/test';

export async function watchCart(page: Page) {
  page.waitForRequest('**/api/cart');
}
