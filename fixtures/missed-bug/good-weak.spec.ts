import { test, expect } from '@playwright/test';

test('real assertions', async ({ page }) => {
  await page.goto('/list');
  await expect(page.locator('tr')).toHaveCount(3);
  expect(await page.locator('tr').count()).toBeGreaterThanOrEqual(1);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token).toBeTruthy();
  const href = await page.getByRole('link', { name: 'Docs' }).getAttribute('href');
  expect(href).toBeDefined();
  expect(await page.getByText('Hello').isVisible()).toBe(true);
});
