import { test, expect } from '@playwright/test';

test('saves the profile', async ({ page }) => {
  await page.goto('/profile');
  page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('opens the profile', async ({ page }) => {
  await page.goto('/profile');
  page.getByRole('button', { name: 'Edit' }).click();
});
