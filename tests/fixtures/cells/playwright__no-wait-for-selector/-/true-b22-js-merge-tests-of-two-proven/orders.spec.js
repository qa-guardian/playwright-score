import { test as base, mergeTests } from '@playwright/test';
const a = base.extend({});
const b = base.extend({});
const test = mergeTests(a, b);

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders-table');
});
