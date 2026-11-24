import { test, expect } from '@playwright/test';

const it = test;

it('report requests', async ({ page }) => {
  const urls = new Set<string>();
  page.on('requestfinished', (request) => {
    urls.add(request.url());
  });
  await page.goto('/reports');
  await page.waitForLoadState('networkidle');
  expect(urls.size).toBeGreaterThan(0);
});
