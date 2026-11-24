import { test } from '@playwright/test';
import { fake } from './runner';

test('orders table loads', async ({ page }) => {
  page = fake;
  await page.waitForSelector('#orders-table');
});
