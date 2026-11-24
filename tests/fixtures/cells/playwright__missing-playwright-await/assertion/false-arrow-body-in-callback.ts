import { test, expect } from '@playwright/test';

async function record(check: Promise<void>): Promise<void> {
  await check;
}

test('dashboard tiles', async ({ page }) => {
  await page.goto('/dashboard');
  const tiles = await page.getByRole('article').all();
  tiles.forEach((tile) => record(expect(tile).toBeVisible()));
});
