import { test, expect } from '@playwright/test';

test('opening the sidebar shows it', async ({ page }) => {
  await page.goto('/orchard');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible({ visible: true });
});
