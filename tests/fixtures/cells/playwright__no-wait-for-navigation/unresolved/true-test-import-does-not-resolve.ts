import { expect } from '@playwright/test';
import { test } from '../../support/missing-fixtures';

test('login redirects', async ({ page }) => {
  await page.goto('/login');
  await page.waitForNavigation();
  await expect(page).toHaveURL(/dashboard/);
});
