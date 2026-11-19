import { test, expect, type Page } from '@playwright/test';

function heading(page: Page) {
  return expect(page.getByRole('heading', { name: 'Cart' }));
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await heading(page).toBeVisible();
});
