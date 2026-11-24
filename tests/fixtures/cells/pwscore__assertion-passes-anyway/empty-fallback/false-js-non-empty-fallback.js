import { test, expect } from '@playwright/test';

test('tab names the page', async ({ page }) => {
  await page.goto('/invoices');
  const heading = await page.locator('h1').textContent();
  await expect(page.getByRole('tab', { selected: true })).toContainText(heading ?? 'Invoices');
});
