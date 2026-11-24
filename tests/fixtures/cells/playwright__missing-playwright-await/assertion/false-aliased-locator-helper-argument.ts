import { test, expect } from '@playwright/test';

async function track(check: unknown): Promise<void> {
  await check;
}

test('home page', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('banner');
  await track(expect(banner).toHaveText('Welcome'));
});
