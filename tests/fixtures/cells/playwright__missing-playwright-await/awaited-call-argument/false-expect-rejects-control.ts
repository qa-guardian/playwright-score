import { test, expect } from '@playwright/test';

test('dialog stays closed', async ({ page }) => {
  await page.goto('/');
  await expect(expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 })).rejects.toThrow();
});
