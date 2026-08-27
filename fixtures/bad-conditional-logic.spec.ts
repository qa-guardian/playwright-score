import { test, expect } from '@playwright/test';

// Fixture: branching logic and debug/handle APIs inside tests.
// Every branch makes the test's behavior depend on runtime page state,
// which is the classic source of tests that "pass" while asserting
// nothing on one of the paths.

test('dismisses banner if present', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'Close' }).isVisible()) {
    await page.getByRole('button', { name: 'Close' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});

test('asserts only on one branch', async ({ page }) => {
  await page.goto('/pricing');
  if (await page.getByRole('dialog').isVisible()) {
    await expect(page.getByRole('dialog')).toContainText('Offer');
  }
  await page.getByRole('link', { name: 'Contact' }).click();
  await expect(page.getByRole('heading', { name: 'Contact' })).toBeVisible();
});

test('uses element handles and pause', async ({ page }) => {
  await page.goto('/');
  const handle = await page.$('#app');
  await page.pause();
  await expect(page.getByRole('main')).toBeVisible();
});
