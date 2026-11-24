import { test, expect } from '@playwright/test';

const rowList = (rows) => ({
  async forEach(check) {
    for (const row of await rows.all()) await check(row);
  },
});

test('order rows', async ({ page }) => {
  await page.goto('/orders');
  await rowList(page.getByRole('row')).forEach(async (row) => {
    await expect(row).toBeVisible();
  });
});
