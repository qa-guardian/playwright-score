import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ ordersPanel: Page }>({
  ordersPanel: async ({ page }, use) => {
    await page.goto('/orders');
    await expect(page.getByRole('alert').isVisible()).toBe(true);
    await use(page);
  },
});
export { expect };
