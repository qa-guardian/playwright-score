import { test, expect } from '@playwright/test';

test('report table loads', async ({ page }) => {
  await page.goto('/reports');
  page.getByText('Loading reports').isHidden();
  await expect(page.getByRole('table')).toBeVisible();
});
