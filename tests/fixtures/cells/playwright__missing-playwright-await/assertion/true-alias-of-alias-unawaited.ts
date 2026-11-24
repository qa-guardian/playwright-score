import { test, expect } from '@playwright/test';

const verify = expect;
const check = verify;

test('profile page shows the display name', async ({ page }) => {
  await page.goto('/profile');
  check(page.getByRole('heading', { level: 1 })).toContainText('Ada');
});
