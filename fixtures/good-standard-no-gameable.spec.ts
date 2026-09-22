import { test, expect } from '@playwright/test';

// The fixed equivalent of bad-gameable.spec.ts: each anti-pattern
// replaced with the real thing it was faking.

test.describe('non-gameable equivalents', () => {
  test('waits for a real condition instead of sleeping', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('clicks a locator instead of a coordinate', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('asserts on real application state', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
  });

  test('pairs soft assertions with at least one hard assertion', async ({ page }) => {
    await page.goto('/app');
    await expect.soft(page.getByRole('heading')).toBeVisible();
    await expect(page.getByText('Saved')).toBeVisible();
  });
});
