import { test, type Page } from '@playwright/test';

let page: Page;
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); });

test('orders table loads', async () => {
  await page.waitForSelector('#orders-table');
});
