import { test, expect } from '@playwright/test';

test('menu opens', async ({ page }) => {
  await page.goto('/');
  const menu = await page.$('#main-menu');
  await menu.click();
  await expect(page.getByRole('menu')).toBeVisible();
});
