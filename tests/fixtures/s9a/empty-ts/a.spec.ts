import { test, expect } from '@playwright/test';

test('is still to be written', async () => {});

test('shows the welcome heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});

test('waits for the order list', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForSelector('#orders');
  await expect(page.getByRole('list', { name: 'Orders' })).toBeVisible();
});
