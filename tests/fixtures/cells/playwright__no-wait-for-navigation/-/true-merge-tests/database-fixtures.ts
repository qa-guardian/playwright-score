import { test as base } from '@playwright/test';

export const test = base.extend<{ seed: number }>({
  seed: async ({}, use) => {
    await use(7);
  },
});
