import { test, expect } from '@playwright/test';

// Fixture: the array is filled by a listener, so asserting it is empty is a
// real check ("no page errors happened"), not expect([]).toEqual([]).
test('home page loads without page errors', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
