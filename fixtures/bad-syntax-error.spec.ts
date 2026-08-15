import { test, expect } from '@playwright/test';

test('broken', async ({ page }) => {
  await page.goto('/foo'
  await expect(page).toHaveTitle('x');
});
