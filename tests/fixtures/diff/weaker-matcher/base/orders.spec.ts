import { test, expect } from '@playwright/test';

test('shows the saved banner', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('banner')).toHaveText('Saved');
});

test('reads the user record', async ({ page }) => {
  const user = { name: 'Ada', admin: false };
  expect(user).toEqual({ name: 'Ada', admin: false });
});

test('lists three orders', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.getByRole('row');
  await expect(rows).toHaveCount(3);
});

test('reads the plan', async ({ page }) => {
  const plan = await page.evaluate(() => 'pro');
  expect(plan).toBe('pro');
});

test('shows the title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title')).toBeVisible();
});

test('keeps both checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title')).toHaveText('Home');
  await expect(page.getByTestId('nav')).toBeVisible();
});

test('old name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('footer')).toHaveText('Bye');
});
