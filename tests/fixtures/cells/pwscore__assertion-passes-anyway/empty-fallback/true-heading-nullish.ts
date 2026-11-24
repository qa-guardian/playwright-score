import { test, expect } from '@playwright/test';

test('breadcrumb names the page', async ({ page }) => {
  await page.goto('/projects/12');
  const heading = await page.locator('h1').textContent();
  await expect(page.getByRole('navigation')).toContainText(heading ?? '');
});
