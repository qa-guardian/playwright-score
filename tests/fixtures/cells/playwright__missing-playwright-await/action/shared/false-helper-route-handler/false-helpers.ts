import { expect, type Page } from '@playwright/test';

export async function stubOrders(page: Page) {
  await page.route('**/api/orders', (route) => {
    route.fulfill({ json: { orders: [] } });
  });
  await page.route('**/api/banners', async (route) => {
    route.abort();
  });
  await page.route('**/api/profile', (route) => {
    route.continue();
  });
}
