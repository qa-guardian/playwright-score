import { test, expect } from '@playwright/test';

async function track(check: unknown): Promise<void> {
  await check;
}

test('main area', async ({ page }) => {
  await page.goto('/');
  const shown = expect(page.getByRole('main')).toBeVisible();
  await track(shown);
});
