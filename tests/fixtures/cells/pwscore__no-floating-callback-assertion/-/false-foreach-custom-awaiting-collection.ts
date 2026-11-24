import { test, expect, type Locator } from '@playwright/test';

class RowList {
  constructor(private readonly rows: Locator) {}

  async forEach(check: (row: Locator) => Promise<void>): Promise<void> {
    for (const row of await this.rows.all()) await check(row);
  }
}

test('order rows', async ({ page }) => {
  await page.goto('/orders');
  const list = new RowList(page.getByRole('row'));
  await list.forEach(async (row) => {
    await expect(row).toBeVisible();
  });
});
