import { test, expect } from '@playwright/test';

async function debugStop(page) {
  await page.pause();
}

test('report page', async ({ page }) => {
  await page.goto('/reports');
  await debugStop(page);
  await expect(page.getByRole('heading')).toBeVisible();
});
