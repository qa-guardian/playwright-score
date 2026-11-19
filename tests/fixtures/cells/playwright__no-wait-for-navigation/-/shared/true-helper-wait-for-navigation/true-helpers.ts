import { type Page } from '@playwright/test';

export async function openCheckout(page: Page) {
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole('link', { name: 'Checkout' }).click(),
  ]);
}
