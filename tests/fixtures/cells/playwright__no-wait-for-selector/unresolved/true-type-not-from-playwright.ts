import { test, expect } from '@playwright/test';
import type { Page } from 'puppeteer';

async function waitForTable(page: Page) {
  await page.waitForSelector('#orders-table');
}

test('orders table', async ({ page }) => {
  await page.goto('/orders');
  await waitForTable(page as never);
  await expect(page.getByRole('table')).toBeVisible();
});
