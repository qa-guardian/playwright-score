import { test, expect } from '@playwright/test';

test('awaits every action', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const field = page.getByLabel('Email');
  await field.fill('a@example.com');
  const nav = page.waitForURL('**/home');
  await Promise.all([nav, page.getByText('Go').click()]);
  const pending = page.getByText('Later').click();
  await pending;
  void page.getByText('Fire').click();
  await expect(page.getByText('Welcome')).toBeVisible();
});

function helper(el: { click(): void }) {
  el.click();
}

test('non-playwright receivers are ignored', async ({ page }) => {
  helper({ click() {} });
  await expect(page.getByText('x')).toBeVisible();
});
