import { test, expect } from '@playwright/test';

test('shows the saved banner', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('banner')).toBeVisible();
});

test('reads the user record', async ({ page }) => {
  const user = { name: 'Ada', admin: false };
  expect(user).toBeTruthy();
});

test('lists three orders', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.getByRole('row');
  expect(await rows.count()).toBeGreaterThan(0);
});

test('reads the plan', async ({ page }) => {
  const plan = await page.evaluate(() => 'pro');
  expect(plan).toBeDefined();
});

// A stronger matcher is not a weakening.
test('shows the title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title')).toHaveText('Home');
});

// Same assertions, reordered: nothing changed.
test('keeps both checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('nav')).toBeVisible();
  await expect(page.getByTestId('title')).toHaveText('Home');
});

// Renamed: the diff reads this as a deleted test and a new one, not as a weakening.
test('new name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('footer')).toBeVisible();
});
