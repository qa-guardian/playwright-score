import { test as base, expect } from '@playwright/test';

// Fixture: the assertion lives in a fixture function injected through the
// test args, not in the test body. The fixture body runs expect(...), so a
// test that uses it is asserting.
const test = base.extend<{ checkAvailabilityTab: (name: string) => Promise<void> }>({
  checkAvailabilityTab: async ({ page }, use) => {
    await use(async (name: string) => {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    });
  },
});

test('availability tab is reachable', async ({ page, checkAvailabilityTab }) => {
  await page.goto('/availability');
  await checkAvailabilityTab('Working hours');
});
