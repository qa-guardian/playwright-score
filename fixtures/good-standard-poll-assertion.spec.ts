import { test, expect } from '@playwright/test';

test.describe('polling assertion', () => {
  test('waits for app to finish loading via expect.poll', async ({ page }) => {
    await page.goto('/');
    await expect
      .poll(async () => (await page.getByTestId('app-loaded').count()) === 1, {
        intervals: [5],
      })
      .toBe(true);
  });
});
