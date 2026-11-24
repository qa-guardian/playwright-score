import { test, expect, type Page } from '@playwright/test';

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test('login redirects', async () => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForNavigation();
  await expect(page).toHaveURL(/dashboard/);
});
