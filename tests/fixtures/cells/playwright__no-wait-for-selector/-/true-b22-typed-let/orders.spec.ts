import { test, type Page } from '@playwright/test';

let adminPage: Page;
test.beforeAll(async ({ browser }) => { adminPage = await browser.newPage(); });

test('orders table loads', async () => {
  await adminPage.waitForSelector('#orders-table');
});
