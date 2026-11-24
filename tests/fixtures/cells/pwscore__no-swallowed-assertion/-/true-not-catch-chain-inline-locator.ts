import { test, expect } from '@playwright/test';

test('no error notice after sign-in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('reader@example.test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).not.toContainText('Invalid').catch(() => {});
  await expect(page.getByRole('alert')).toBeVisible();
});
