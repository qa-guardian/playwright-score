import { test as base } from '@playwright/test';
import { fake } from './runner';
const test = base.extend({ page: async ({}, use) => { await use(fake); } });

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForNavigation();
});
