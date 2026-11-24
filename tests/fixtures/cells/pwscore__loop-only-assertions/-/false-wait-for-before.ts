import { test, expect } from '@playwright/test';

test('every article card is shown after loading', async ({ page }) => {
  await page.goto('/journal');
  const cards = page.getByRole('article');
  await cards.first().waitFor();
  for (const card of await cards.all()) {
    await expect(card).toBeVisible();
  }
});
