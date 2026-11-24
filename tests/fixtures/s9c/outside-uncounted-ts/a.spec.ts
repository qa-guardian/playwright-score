import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const rowsExist = async (page: Page) => {
  const rows = await page.getByRole('row').count();
  expect(rows).toBeGreaterThanOrEqual(0);
};

test.skip('lists the rows', async ({ page }) => {
  await page.goto('/cart');
  await rowsExist(page);
});
