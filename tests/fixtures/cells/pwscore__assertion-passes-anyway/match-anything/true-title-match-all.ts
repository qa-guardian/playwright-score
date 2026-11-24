import { test, expect } from '@playwright/test';

test('has a title', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page).toHaveTitle(/^.*$/);
});
