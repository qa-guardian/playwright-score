import { test, expect, type Page } from '@playwright/test';


function titleIs(page: Page, title: string) {
  return expect(page).toHaveTitle(title);
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await titleIs(page, 'Cart');
});
