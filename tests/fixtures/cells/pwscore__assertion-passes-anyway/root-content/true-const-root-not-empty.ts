import { test, expect } from '@playwright/test';

test('inbox renders', async ({ page }) => {
  await page.goto('/inbox');
  const shell = page.locator('body');
  await expect(shell).not.toBeEmpty();
});
