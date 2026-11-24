import { test, expect } from '@playwright/test';

test('has some title', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page).toHaveTitle(/.+/);
});
