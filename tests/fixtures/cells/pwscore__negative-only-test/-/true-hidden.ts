import { test, expect } from '@playwright/test';

test('saving closes the editor', async ({ page }) => {
  await page.goto('/garden/beds/4');
  await page.getByLabel('Bed name').fill('Herbs');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit bed' })).toBeHidden();
});
