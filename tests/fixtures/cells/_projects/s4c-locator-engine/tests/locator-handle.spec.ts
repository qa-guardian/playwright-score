import { test, expect } from '@playwright/test';

test('order table', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.locator('tr');
  const handles = await rows.elementHandles();
  expect(handles.length).toBeGreaterThan(0);
});
