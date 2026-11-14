import { test as base, expect } from '@playwright/test';
export const test = base.extend<{ login: void }>({
  login: async ({ page }, use) => { await page.goto('/login'); await expect(page).toHaveURL(/login/); await use(); },
});
