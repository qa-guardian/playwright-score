import { test, expect } from '@playwright/test';

test('the main links are shown', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Journal', 'Recipes', 'Gallery']) {
    await expect(page.getByRole('link', { name })).toBeVisible();
  }
});
