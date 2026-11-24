import { test, expect } from '@playwright/test';

async function whenDone(work: Promise<void>): Promise<void> {
  await work;
}

test('settings link', async ({ page }) => {
  await page.goto('/');
  await whenDone(test.step('open settings', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
  }));
});
