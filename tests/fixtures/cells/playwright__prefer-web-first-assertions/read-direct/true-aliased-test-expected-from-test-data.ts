import { test, expect } from '@playwright/test';

const it = test;

it('profile name', async ({ page }) => {
  const expected = 'Rowan';
  await page.goto('/profile');
  expect(await page.getByTestId('header-name').textContent()).toBe(expected);
});
