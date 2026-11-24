import { test, expect } from '@playwright/test';

test('search results', async ({ page }) => {
  await page.goto('/search');
  const terms = ['tea', 'milk'];
  terms.map(async (term) => {
    await expect(async () => {
      await page.getByRole('searchbox').fill(term);
      await expect(page.getByRole('listitem').first()).toBeVisible();
    }).toPass();
  });
});
