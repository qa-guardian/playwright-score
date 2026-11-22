import { test } from '@playwright/test';
import { fake } from './runner';
test.use({ page: async ({}, use) => { await use(fake); } });

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForNavigation();
});
