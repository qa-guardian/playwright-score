import { test, expect } from '@playwright/test';
import { findRow } from 'table-row-kit';

test('order row', async ({ page }) => {
  await page.goto('/orders');
  const row = findRow(page, 'Order 1001');
  const handle = await row.elementHandle();
  expect(handle).toBeTruthy();
});
