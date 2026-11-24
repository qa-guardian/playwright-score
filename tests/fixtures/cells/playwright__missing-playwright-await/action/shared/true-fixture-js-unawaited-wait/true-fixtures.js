import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  ordersPanel: async ({ page }, use) => {
    await page.goto('/orders');
    page.waitForResponse('**/api/orders');
    await use(page);
  },
});
export { expect };
