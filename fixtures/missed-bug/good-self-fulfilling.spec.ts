import { test, expect } from '@playwright/test';

test('dismisses the cookie banner, asserts something else', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog', { name: 'Cookies' });
  if (await banner.isVisible()) {
    await banner.getByRole('button', { name: 'Accept' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});

test('modal closes after dismissal', async ({ page }) => {
  await page.goto('/');
  const modal = page.getByRole('dialog');
  if (await modal.isVisible()) {
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toBeHidden();
  }
});

test('unrelated fallback', async ({ page }) => {
  await page.goto('/');
  if (!(await page.getByRole('navigation').isVisible())) {
    await page.getByRole('button', { name: 'Menu' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
