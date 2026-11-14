import { test, expect } from '@playwright/test';

// Fixture: a real expect() with no matcher call asserts nothing.
test('forgets the matcher', async ({ page }) => {
  await page.goto('/');
  expect(page.getByRole('heading', { name: 'Home' }));
});
