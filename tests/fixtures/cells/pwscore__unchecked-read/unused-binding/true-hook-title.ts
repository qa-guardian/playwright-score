import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/projects');
  const heading = await page.title();
});

test('creates a project', async ({ page }) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
