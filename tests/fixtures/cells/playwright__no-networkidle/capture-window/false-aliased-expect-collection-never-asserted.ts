import { test, expect } from '@playwright/test';

const check = expect;
const state = 'networkidle';

test('dashboard heading', async ({ page }) => {
  let failed = 0;
  page.on('response', (response) => {
    if (!response.ok()) failed++;
  });
  await page.goto('/dashboard');
  await page.waitForLoadState(state);
  await check(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
