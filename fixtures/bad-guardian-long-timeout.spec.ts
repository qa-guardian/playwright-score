import { test, expect } from '@playwright/test';

test.describe('Report generation', () => {
  test('waits with a non-standard timeout', async ({ page }) => {
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Generate' }).click();
    await expect(page.getByText('Done')).toBeVisible({ timeout: 45000 });
  });
});
