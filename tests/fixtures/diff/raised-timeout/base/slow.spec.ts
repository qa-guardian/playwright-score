import { test, expect } from '@playwright/test';

test('whole-test timeout', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/report');
  await expect(page.getByTestId('done')).toBeVisible();
});

test('assertion timeout', async ({ page }) => {
  await page.goto('/report');
  await expect(page.getByTestId('done')).toBeVisible({ timeout: 5000 });
});

test('waitFor timeout', async ({ page }) => {
  await page.goto('/report');
  await page.getByTestId('spinner').waitFor({ state: 'hidden', timeout: 5 * 1000 });
  await expect(page.getByTestId('done')).toBeVisible();
});

test('timeout lowered', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/report');
  await expect(page.getByTestId('done')).toBeVisible({ timeout: 20000 });
});

test('timeout raised under 2x', async ({ page }) => {
  test.setTimeout(10000);
  await page.goto('/report');
  await expect(page.getByTestId('done')).toBeVisible({ timeout: 4000 });
});

test('timeout added where there was none', async ({ page }) => {
  await page.goto('/report');
  await expect(page.getByTestId('done')).toBeVisible();
});
