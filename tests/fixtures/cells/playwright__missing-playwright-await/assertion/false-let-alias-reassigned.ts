import { test, expect } from '@playwright/test';

let check = expect;

test.beforeEach(() => {
  check = expect.configure({ timeout: 10_000 });
});

test('upload finishes', async ({ page }) => {
  await page.goto('/uploads');
  check(page.getByText('Upload complete')).toBeVisible();
});
