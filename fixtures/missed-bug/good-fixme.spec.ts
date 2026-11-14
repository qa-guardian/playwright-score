import { test, expect } from '@playwright/test';

test('profile page', async ({ page, browserName }) => {
  test.fixme(browserName === 'webkit', 'Safari renders the header differently, tracked upstream');
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
});
