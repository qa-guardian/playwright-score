import { test, expect } from '@playwright/test';

declare function collect(into: number[]): void;

// Fixture: the array may be filled by code the scan cannot see (passed as a
// call argument, push() in a closure), so the assertions are real.
test('filled by a callee', async () => {
  const seen: number[] = [];
  collect(seen);
  expect(seen).toEqual([]);
});

test('pushed to in a closure', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
  });
  await page.goto('/');
  expect(errors).toEqual([]);
});
