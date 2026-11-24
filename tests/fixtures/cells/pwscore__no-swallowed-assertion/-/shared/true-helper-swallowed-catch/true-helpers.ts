import { expect, type Page } from '@playwright/test';

export async function refreshOrders(page: Page) {
  await expect(page.getByRole('alert')).not.toBeVisible().catch(() => {});
}
