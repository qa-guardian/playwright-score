import { test as base } from '@playwright/test';

const test = base;

// Never imports the fixtures module, so its fixtures cannot apply here.
test('plain page test, no assertion', async ({ page }) => {
  await page.click('#delete');
});
