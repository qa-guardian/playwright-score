import { test, expect } from '@playwright/test';

test('rethrows with context', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    await page.screenshot({ path: 'banner.png' });
    throw e;
  }
});

test('retry until visible', async ({ page }) => {
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    try {
      await expect(page.getByRole('banner')).toBeVisible({ timeout: 2000 });
      break;
    } catch {
      await page.reload();
    }
  }
  await expect(page.getByRole('banner')).toBeVisible();
});

test('optional probe returns a value that is asserted', async ({ page }) => {
  await page.goto('/');
  const shown = await (async () => {
    try {
      await expect(page.getByRole('banner')).toBeVisible({ timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  })();
  expect(shown).toBe(true);
});
