import { test, expect } from '@playwright/test';

test('article cards are shown', async ({ page }) => {
  await page.goto('/journal');
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    await expect(card.getByRole('heading')).toBeVisible();
  }
});
