import { test, expect } from '@playwright/test';

test('shows the plan', async ({ page }) => {
  await page.goto('/billing');
  await expect(page.getByTestId('plan-name')).toContainText('');
});
