import { test, expect } from '@playwright/test';

test('title is read', async ({ page }) => {
  await page.goto('/about');
  await page.getByRole('heading', { level: 1 }).textContent();
  await expect(page.getByRole('main')).toContainText('Our team');
});
