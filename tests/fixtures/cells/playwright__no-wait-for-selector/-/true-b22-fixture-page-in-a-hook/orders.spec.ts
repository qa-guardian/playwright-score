import { test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.waitForSelector('#orders-table');
});
