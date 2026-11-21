const { test, expect, chromium } = require('@playwright/test');

test('own browser', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('/settings');
  await page.pause();
  await expect(page.getByRole('heading')).toBeVisible();
  await browser.close();
});
