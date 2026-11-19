import { test, expect } from '@playwright/test';

test('reports page', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('grid', { name: 'Monthly totals' })).toBeVisible();
});
