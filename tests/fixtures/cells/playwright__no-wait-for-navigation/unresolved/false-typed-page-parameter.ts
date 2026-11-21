import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForNavigation();
}

test('login redirects', async ({ page }) => {
  await page.goto('/login');
  await signIn(page);
  await expect(page).toHaveURL(/dashboard/);
});
