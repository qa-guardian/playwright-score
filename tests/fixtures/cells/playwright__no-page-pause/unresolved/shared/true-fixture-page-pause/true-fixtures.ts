import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ ordersPanel: Page }>({
  ordersPanel: async ({ page }, use) => {
    await page.goto('/orders');
    await page.pause();
    await use(page);
  },
});
export { expect };
