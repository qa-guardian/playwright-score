import { test, expect, type Locator } from '@playwright/test';

const check = expect;

async function confirmBanner(check: typeof expect, banner: Locator) {
  check(banner).toBeVisible();
}

test('banner after save', async ({ page }) => {
  await page.goto('/settings');
  await check(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await confirmBanner(expect, page.getByRole('status'));
});
