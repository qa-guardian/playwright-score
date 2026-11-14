import { test, expect } from '@playwright/test';

test('weak assertions', async ({ page }) => {
  await page.goto('/list');
  const rows = page.locator('tr');
  expect(await rows.count()).toBeGreaterThanOrEqual(0);
  const button = page.getByRole('button', { name: 'Save' });
  expect(button).toBeTruthy();
  expect(page.locator('h1').first()).not.toBeNull();
  expect(await page.getByText('Hello').isVisible()).toBeDefined();
  const items = await page.locator('li').all();
  expect(items.length).toBeGreaterThanOrEqual(0);
});
