import { test, expect } from '@playwright/test';

test('report grid', async ({ page }) => {
  const grid = {
    async elementHandle() {
      return page.getByRole('grid', { name: 'Monthly report' });
    },
  };
  await page.goto('/reports');
  const table = await grid.elementHandle();
  await expect(table).toBeVisible();
});
