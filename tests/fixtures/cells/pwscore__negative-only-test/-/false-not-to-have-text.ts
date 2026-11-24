import { test, expect } from '@playwright/test';

test('renaming replaces the old title', async ({ page }) => {
  await page.goto('/notebook/12');
  await page.getByLabel('Title').fill('Spring sowing');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Untitled');
});
