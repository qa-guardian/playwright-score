import { test, expect } from '@playwright/test';

test('links to the release notes', async ({ page }) => {
  await page.goto('/');
  const href = await page.getByRole('link', { name: 'Release notes' }).getAttribute('href');
  await page.getByRole('link', { name: 'Release notes' }).click();
});
