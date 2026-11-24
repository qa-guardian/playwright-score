import { test, expect, type Page } from '@playwright/test';

async function bannerShown(page: Page) {
  return page.getByRole('alert').isVisible();
}

test('banner after save', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await bannerShown(page)).toBe(true);
});
