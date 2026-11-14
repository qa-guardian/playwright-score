import { test as base, expect } from '@playwright/test';
const checkFn = async () => { await expect(1).toBe(1); };
export const test = base.extend<{ a11y: () => Promise<void>; toastGone: () => Promise<void>; maybe: (u?: string) => Promise<void> }>({
  a11y: async ({ page }, use) => { await use(async () => { await expect(page.locator('.violations')).toHaveCount(0); }); },
  toastGone: async ({ page }, use) => { await use(checkFn); },
  maybe: async ({ page }, use) => { await use(async (u?: string) => { if (u) await expect(page).toHaveURL(u); }); },
});
export { expect };
