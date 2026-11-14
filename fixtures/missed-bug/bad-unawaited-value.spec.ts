import { test, expect } from '@playwright/test';

test('compares promises', async ({ page }) => {
  await page.goto('/');
  const other = page.locator('h2');
  expect(page.locator('h1').innerText()).not.toBe(other.innerText());
  expect(page.title()).toBe('Home');
});
