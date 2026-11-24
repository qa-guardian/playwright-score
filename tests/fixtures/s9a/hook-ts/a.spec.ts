import { test, expect } from '@playwright/test';

test.describe('account', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/account');
    await page.waitForSelector('#account');
  });

  test('shows the name', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  });

  test('shows the plan', async ({ page }) => {
    await expect(page.getByText('Plan: Team')).toBeVisible();
  });
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
