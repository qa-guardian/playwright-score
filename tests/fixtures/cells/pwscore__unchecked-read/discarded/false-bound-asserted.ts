import { test, expect } from '@playwright/test';

test('notice is shown', async ({ page }) => {
  await page.goto('/billing');
  const shown = await page.getByRole('status').isVisible();
  expect(shown).toBe(true);
});
