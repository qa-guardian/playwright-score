import { test, expect } from '@playwright/test';

test('collapsing the sidebar hides it', async ({ page }) => {
  await page.goto('/orchard');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible({ visible: false });
});
