import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.route('**/api/cart', (route) => {
    route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/ads', async (route) => {
    route.abort();
  });
  await page.route('**/api/user', (route) => {
    route.continue();
  });
  await page.route('**/api/cart/**', (route) => {
    route.fallback();
  });
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
