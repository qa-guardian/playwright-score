import { test, expect } from '@playwright/test';

test('notes keep their template', async ({ page }) => {
  await page.goto('/orders/7/notes');
  await page.locator('textarea[name=notes]').fill('Leave at the door');
  await expect(page.locator('textarea[name=notes]')).toHaveText('');
});
