import { test, expect } from '@playwright/test';

test('next cover', async ({ page }) => {
  await page.goto('/gallery');
  const tile = page.getByRole('img', { name: 'Cover' });
  const prior = await tile.getAttribute('src');
  await page.getByRole('button', { name: 'Next' }).click();
  expect(await tile.getAttribute('src')).not.toBe(prior);
});
