import { test, expect } from '@playwright/test';

test('dashboard errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  expect(errors).toEqual([]);
});
