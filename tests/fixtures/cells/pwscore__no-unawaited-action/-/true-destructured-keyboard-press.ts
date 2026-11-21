import { test, expect } from '@playwright/test';

test('submit with enter', async ({ page }) => {
  await page.goto('/search');
  const { keyboard } = page;
  keyboard.press('Enter');
  await expect(page.getByRole('list')).toBeVisible();
});
