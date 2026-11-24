import { test, expect, type Page } from '@playwright/test';

function expectToast(p: Page) {
  return expect(p.getByRole('status'));
}

test('saving shows a toast', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).click();
  await expectToast(page).toBeVisible();
});
