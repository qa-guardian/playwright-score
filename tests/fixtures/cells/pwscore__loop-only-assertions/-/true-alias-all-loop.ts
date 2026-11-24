import { test, expect } from '@playwright/test';

test('every saved recipe has a title', async ({ page }) => {
  await page.goto('/recipes/saved');
  const recipes = page.getByRole('listitem').filter({ hasText: 'Recipe' });
  const items = await recipes.all();
  for (const item of items) {
    await expect(item.getByRole('heading')).toHaveText(/\w+/);
  }
});
