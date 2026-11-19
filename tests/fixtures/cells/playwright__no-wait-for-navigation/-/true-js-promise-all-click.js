import { test, expect } from '@playwright/test';

test('docs landing', async ({ page }) => {
  await page.goto('/docs');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('link', { name: 'Getting started' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
