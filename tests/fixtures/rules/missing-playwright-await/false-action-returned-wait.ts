import { test, expect, type Page } from '@playwright/test';

function cartResponse(page: Page) {
  return page.waitForResponse('**/api/cart');
}

test('cart page', async ({ page }) => {
  const response = cartResponse(page);
  await page.goto('/cart');
  await response;
  await expect(page.getByRole('heading')).toBeVisible();
});
