import { type Page } from '@playwright/test';

export async function openCart(page: Page) {
  await page.goto('/cart');
  await page.waitForLoadState('networkidle');
}
