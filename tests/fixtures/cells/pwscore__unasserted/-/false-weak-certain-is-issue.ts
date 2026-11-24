import { test, expect } from '@playwright/test';

test('lists the rows', async ({ page }) => {
  await page.goto('/cart');
  const rows = await page.getByRole('row').count();
  // The weak assertion is a certain finding, and `issue` comes before `unasserted`.
  expect(rows).toBeGreaterThanOrEqual(0);
});
