import { test as base, expect } from '@playwright/test';

// `page` and `loggedIn` assert only in their SETUP; neither hands an
// asserting callable to use(), so no test gains an assertion from them.
export const test = base.extend<{ loggedIn: void }>({
  page: async ({ page }, use) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/App/);
    await use(page);
  },
  loggedIn: async ({ page }, use) => {
    await page.fill('#user', 'x');
    await expect(page.locator('#me')).toBeVisible();
    await use();
  },
});
