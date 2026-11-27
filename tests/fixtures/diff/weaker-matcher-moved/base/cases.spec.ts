import { test, expect } from '@playwright/test';

test('subject moved to a child', async ({ page }) => {
  const row = page.getByRole('row');
  await expect(row).toHaveText('Order #123');
});

test('regex base argument', async ({ page }) => {
  await expect(page.getByTestId('hello')).toHaveText(/Welcome/);
});

test('object base argument', async ({ page }) => {
  const user = await page.evaluate(() => ({ name: 'Ada', admin: false }));
  expect(user).toEqual(expect.objectContaining({ name: 'Ada' }));
});

test('boolean read as truthy', async ({ page }) => {
  const btn = page.getByRole('button');
  expect(await btn.isEnabled()).toBe(true);
});

test('single count read as visible', async ({ page }) => {
  await expect(page.getByTestId('banner')).toHaveCount(1);
});

test('genuine weakening on the same subject', async ({ page }) => {
  await expect(page.getByTestId('order')).toHaveText('Order #123');
});
