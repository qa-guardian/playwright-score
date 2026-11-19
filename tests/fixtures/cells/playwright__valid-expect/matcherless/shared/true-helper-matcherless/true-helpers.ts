import { expect, type Page } from '@playwright/test';

export async function checkHeading(page: Page) {
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible;
}
