import { test, expect } from '@playwright/test';

test('pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await Promise.all([
    page.getByRole('button', { name: 'Start trial' }).click(),
    page.waitForNavigation(),
  ]);
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
});
