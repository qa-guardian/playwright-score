import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ ordersPanel: Page }>({
  ordersPanel: async ({ page }, use) => {
    await page.goto('/orders');
    expect(page.url()).toBe('https://shop.example/orders');
    await use(page);
  },
});
export { expect };
