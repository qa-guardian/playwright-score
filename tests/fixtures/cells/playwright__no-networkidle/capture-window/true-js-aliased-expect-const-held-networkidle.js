const { test, expect } = require('@playwright/test');

const check = expect;
const state = 'networkidle';

test('dashboard responses', async ({ page }) => {
  let failed = 0;
  page.on('response', (response) => {
    if (!response.ok()) failed++;
  });
  await page.goto('/dashboard');
  await page.waitForLoadState(state);
  check(failed).toBe(0);
});
