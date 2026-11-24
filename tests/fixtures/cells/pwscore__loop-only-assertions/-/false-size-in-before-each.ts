import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/journal');
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('every article card has a heading', async ({ page }) => {
  for (const card of await page.getByRole('article').all()) {
    await expect(card.getByRole('heading')).toBeVisible();
  }
});
