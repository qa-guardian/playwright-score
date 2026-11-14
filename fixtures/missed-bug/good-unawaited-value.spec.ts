import { test, expect } from '@playwright/test';

test('awaits values', async ({ page, loginPage }) => {
  await page.goto('/');
  const other = page.locator('h2');
  expect(await page.locator('h1').innerText()).not.toBe(await other.innerText());
  await expect(page.locator('h1')).toBeVisible();
  await expect(page).toHaveTitle('Home');
  await expect(page.locator('h1').innerText()).resolves.toBe('Welcome');
  await expect.poll(() => page.title()).toBe('Home');
  const first = await page.locator('h1').innerText();
  const second = await page.locator('h2').innerText();
  expect(first).not.toBe(second);
  expect(loginPage.title()).toBe('Home');
});
