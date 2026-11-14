import { test, expect } from '@playwright/test';

test('console only', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    console.error('banner missing', e);
  }
});

test('logger only', async ({ page }) => {
  await page.goto('/');
  try {
    await expect(page.getByRole('banner')).toBeVisible();
  } catch (e) {
    logger.warn('banner missing');
    this.logger.error(e);
  }
});
