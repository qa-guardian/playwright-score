import { test, expect } from '@playwright/test';

test('title is never set', async ({ page }) => {
  await page.goto('/blank');
  await expect(page).not.toHaveTitle(/.*/);
});
