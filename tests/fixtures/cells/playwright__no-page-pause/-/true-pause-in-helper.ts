import { test, expect, type Page } from '@playwright/test';

async function debugStop(page: Page) {
  await page.pause();
}

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await debugStop(page);
  await expect(page.getByRole('heading')).toBeVisible();
});
