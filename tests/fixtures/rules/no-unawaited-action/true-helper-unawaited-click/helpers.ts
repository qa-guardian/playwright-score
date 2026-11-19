import { test, expect, type Page } from '@playwright/test';

export async function checkout(page: Page) {
  page.getByRole('button', { name: 'Checkout' }).click();
}
