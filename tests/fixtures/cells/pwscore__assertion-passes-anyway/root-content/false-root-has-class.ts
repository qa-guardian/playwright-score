import { test, expect } from '@playwright/test';

test('dark theme is applied', async ({ page }) => {
  await page.goto('/settings/appearance');
  await page.getByRole('switch', { name: 'Dark theme' }).check();
  await expect(page.locator('body')).toHaveClass(/dark-theme/);
});
