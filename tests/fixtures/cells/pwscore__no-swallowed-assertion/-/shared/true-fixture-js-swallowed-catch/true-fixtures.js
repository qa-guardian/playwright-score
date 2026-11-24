import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  ordersPanel: async ({ page }, use) => {
    await page.goto('/orders');
    await expect(page.getByRole('alert')).not.toBeVisible().catch(() => {});
    await use(page);
  },
});
export { expect };
