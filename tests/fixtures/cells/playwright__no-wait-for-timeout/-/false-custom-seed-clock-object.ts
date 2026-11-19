import { test, expect } from '@playwright/test';

const fakeTimer = { waitForTimeout: (delay: number) => delay * 2 };

test('news feed', async ({ page }) => {
  fakeTimer.waitForTimeout(250);
  await page.goto('/news');
  await expect(page.getByRole('heading', { name: 'Latest' })).toBeVisible();
});
