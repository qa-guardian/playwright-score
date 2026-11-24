import { test, expect } from '@playwright/test';

test('rows', async ({ page }) => {
  await page.goto('/');
  const rows: Promise<void>[] = [];
  rows.push(expect(page.getByRole('row')).toHaveCount(3));
});
