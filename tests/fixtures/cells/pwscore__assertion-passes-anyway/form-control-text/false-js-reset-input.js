import { test, expect } from '@playwright/test';

test('reset button is not renamed', async ({ page }) => {
  await page.goto('/filters');
  await expect(page.locator('input[type=reset]')).not.toContainText('Undo');
});
