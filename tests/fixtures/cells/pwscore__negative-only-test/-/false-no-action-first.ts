import { test, expect } from '@playwright/test';

test('no dialog is open at the start', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/orchard');
});
