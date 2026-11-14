import { test, expect } from '@playwright/test';

// Fixture: an array that is never touched again. These can only pass.
test('constant array is compared with itself', async ({ page }) => {
  await page.goto('/');
  const errors: string[] = [];
  expect(errors).toEqual([]);
});

test('literal array is compared with itself', async ({ page }) => {
  await page.goto('/');
  expect([]).toEqual([]);
});
