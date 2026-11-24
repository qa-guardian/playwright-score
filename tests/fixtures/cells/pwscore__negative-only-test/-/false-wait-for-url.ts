import { test, expect } from '@playwright/test';

test('saving a bed returns to the list', async ({ page }) => {
  await page.goto('/garden/beds/4');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL('**/garden/beds');
  await expect(page.getByRole('dialog', { name: 'Edit bed' })).toBeHidden();
});
