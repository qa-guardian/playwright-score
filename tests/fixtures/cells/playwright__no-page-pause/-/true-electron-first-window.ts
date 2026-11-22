import { test, expect, _electron as electron } from '@playwright/test';

test('main window', async () => {
  const electronApp = await electron.launch({ args: ['main.js'] });
  const page = await electronApp.firstWindow();
  await page.pause();
  await expect(page.getByRole('heading')).toBeVisible();
  await electronApp.close();
});
