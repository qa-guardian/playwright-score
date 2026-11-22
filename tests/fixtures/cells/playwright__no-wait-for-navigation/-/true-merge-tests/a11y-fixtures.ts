import { test as base } from '@playwright/test';

export const test = base.extend<{ contrast: string }>({
  contrast: async ({}, use) => {
    await use('high');
  },
});
