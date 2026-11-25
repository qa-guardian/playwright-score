import { test, expect } from '@playwright/test';

test('the sidebar is not hidden after a reload', async ({ page }) => {
  await page.goto('/orchard');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).not.toBeVisible({ visible: false });
});
