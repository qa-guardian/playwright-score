import { test, expect } from '@playwright/test';

async function track(check) {
  await check;
}

test('done banner', async ({ page }) => {
  await page.goto('/');
  const pending = track(expect(page.getByText('Done')).toBeVisible());
});
