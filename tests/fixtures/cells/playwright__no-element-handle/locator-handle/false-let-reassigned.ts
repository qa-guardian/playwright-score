import { test, expect } from '@playwright/test';

test('totals row', async ({ page }) => {
  await page.goto('/orders');
  let rows = page.locator('tr');
  rows = rows.filter({ hasText: 'Total' });
  const handles = await rows.elementHandles();
  expect(handles).toHaveLength(1);
});
