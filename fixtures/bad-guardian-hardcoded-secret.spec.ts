import { test, expect } from '@playwright/test';

test.describe('Login', () => {
  test('logs in with a hardcoded password', async ({ page }) => {
    const apiToken = 'sk_live_9f8a7b6c5d4e3f2a1b0c';
    await page.goto('/login');
    await page.getByLabel('Token').fill(apiToken);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Welcome')).toBeVisible();
  });
});
