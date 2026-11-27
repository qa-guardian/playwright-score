import { test, expect } from '@playwright/test';

test('subject moved to a child', async ({ page }) => {
  const row = page.getByRole('row');
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell')).toHaveText('Order #123');
});

test('regex base argument', async ({ page }) => {
  await expect(page.getByTestId('hello')).toContainText('Welcome back');
});

test('object base argument', async ({ page }) => {
  const user = await page.evaluate(() => ({ name: 'Ada', admin: false }));
  expect(user).toMatchObject({ name: 'Ada' });
});

test('boolean read as truthy', async ({ page }) => {
  const btn = page.getByRole('button');
  expect(await btn.isEnabled()).toBeTruthy();
});

test('single count read as visible', async ({ page }) => {
  await expect(page.getByTestId('banner')).toBeVisible();
});

test('genuine weakening on the same subject', async ({ page }) => {
  await expect(page.getByTestId('order')).toBeVisible();
});
