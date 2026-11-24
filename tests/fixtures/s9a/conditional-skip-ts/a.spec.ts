import { test, expect } from '@playwright/test';

test('exports the report', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Export is not available on WebKit');
  await page.goto('/reports');
  await page.waitForSelector('#reports');
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
