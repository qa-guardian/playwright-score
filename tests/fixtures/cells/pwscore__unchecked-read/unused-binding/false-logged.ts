import { test, expect } from '@playwright/test';

test('prints the page title', async ({ page }) => {
  await page.goto('/help');
  const title = await page.title();
  console.log(title);
  await expect(page.getByRole('searchbox')).toBeVisible();
});
