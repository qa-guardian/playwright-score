import { test as base } from '@playwright/test';

export const test = base.extend<{ seed: string }>({
  seed: async ({}, use) => {
    await use('seed');
  },
});

export function testWithConfig(config: { locale: string }) {
  return test.extend({
    seed: async ({}, use) => {
      await use(config.locale);
    },
  });
}

export const testWithOther = (config: { locale: string }) => testWithConfig(config);

export function notAFactory() {
  return { run: () => 1 };
}
