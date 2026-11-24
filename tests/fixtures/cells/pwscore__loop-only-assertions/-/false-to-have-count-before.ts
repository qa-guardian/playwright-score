import { test, expect } from '@playwright/test';

test('four article cards are shown', async ({ page }) => {
  await page.goto('/journal');
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all()) {
    await expect(card).toBeVisible();
  }
});
