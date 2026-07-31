import { test } from '@playwright/test';

test.describe('No assertions', () => {
  test('clicks around', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Go' }).click();
  });
});
