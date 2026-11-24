import { expect, type Page } from '@playwright/test';

export async function expectCartCount(page: Page, count: number) {
  await expect(page.getByTestId('cart-count')).toHaveText(String(count));
}
