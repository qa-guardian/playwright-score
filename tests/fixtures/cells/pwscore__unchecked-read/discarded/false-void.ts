import { test, expect } from '@playwright/test';

test('status is polled', async ({ page }) => {
  await page.goto('/jobs');
  void page.getByRole('status').isVisible();
  await expect(page.getByRole('row')).toHaveCount(3);
});
