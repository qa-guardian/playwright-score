import { test as base } from '@playwright/test';

export const test = base.extend<{ account: string }>({
  account: async ({}, use) => {
    await use('ada');
  },
});
export { expect } from '@playwright/test';
