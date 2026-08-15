import { test, expect, type Page } from '@playwright/test';

async function assertDashboardLoaded(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function expectNoAccessibilityViolations(page: Page) {
  await expect(page.getByRole('main')).toBeVisible();
}

test.describe('dashboard', () => {
  test('loads via a shared assertion helper', async ({ page }) => {
    await page.goto('/dashboard');
    await assertDashboardLoaded(page);
  });

  test('is accessible via a shared expect-prefixed helper', async ({ page }) => {
    await page.goto('/dashboard');
    await expectNoAccessibilityViolations(page);
  });
});
