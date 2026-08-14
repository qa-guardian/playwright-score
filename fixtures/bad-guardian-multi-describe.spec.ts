import { test, expect } from '@playwright/test';

test.describe('Projects', () => {
  test('can create a project', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  });
});

test.describe('Billing', () => {
  test('can view invoices', async ({ page }) => {
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  });
});
