import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  ordersPanel: async ({ page }, use) => {
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible;
    await use(page);
  },
});
export { expect };
