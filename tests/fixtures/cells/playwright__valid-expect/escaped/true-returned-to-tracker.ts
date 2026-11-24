import { test, expect, type Page } from '@playwright/test';
import { track } from 'soft-check-queue';

function expectToast(p: Page) {
  return expect(p.getByRole('status'));
}

test('saving shows a toast', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).click();
  track(expectToast(page));
});
