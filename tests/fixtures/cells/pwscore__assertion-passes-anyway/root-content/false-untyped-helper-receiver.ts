import { test, expect } from '@playwright/test';

async function expectShell(view) {
  await expect(view.locator('body')).toBeVisible();
}

test('shell renders', async ({ page }) => {
  await page.goto('/shell');
  await expectShell(page);
  await expect(page.getByRole('main')).toBeVisible();
});
