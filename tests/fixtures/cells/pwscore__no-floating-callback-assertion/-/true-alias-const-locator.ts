import { test, expect } from '@playwright/test';

test('order rows', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.getByRole('row');
  ['Open', 'Shipped'].forEach(async (status) => {
    await expect(rows.filter({ hasText: status })).toHaveCount(1);
  });
});
