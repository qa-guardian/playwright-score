import { test, expect } from '@playwright/test';

test('inbox list', async ({ page }) => {
  await page.goto('/inbox');
  for (const item of await page.getByRole('listitem').all()) {
    await expect(item).toBeEnabled();
  }
});
