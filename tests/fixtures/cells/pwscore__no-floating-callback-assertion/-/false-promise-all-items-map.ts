import { test, expect } from '@playwright/test';

test('inbox list', async ({ page }) => {
  await page.goto('/inbox');
  const items = await page.getByRole('listitem').all();
  await Promise.all(
    items.map(async (item) => {
      await expect(item).toBeEnabled();
    }),
  );
});
