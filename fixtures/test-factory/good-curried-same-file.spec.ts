import { test as base, expect } from '@playwright/test';

function testWithLocale(locale: string) {
  return base.extend<{ locale: string }>({
    locale: async ({}, use) => {
      await use(locale);
    },
  });
}

testWithLocale('en')('curried test, factory defined in the same file', async ({ page, locale }) => {
  await page.goto('https://example.com');
  await expect(page.getByText(locale)).toBeVisible();
});
