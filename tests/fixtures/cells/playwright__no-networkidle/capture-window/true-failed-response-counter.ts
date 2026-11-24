import { test, expect } from '@playwright/test';

test('dashboard responses', async ({ page }) => {
  let failed = 0;
  page.on('response', (response) => {
    if (!response.ok()) failed++;
  });
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  expect(failed).toBe(0);
});
