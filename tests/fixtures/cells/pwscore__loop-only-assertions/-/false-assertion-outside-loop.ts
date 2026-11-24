import { test, expect } from '@playwright/test';

test('every article card is shown on the journal page', async ({ page }) => {
  await page.goto('/journal');
  for (const card of await page.getByRole('article').all()) {
    await expect(card).toBeVisible();
  }
  await expect(page).toHaveTitle(/Journal/);
});
