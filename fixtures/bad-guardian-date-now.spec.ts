import { test, expect } from '@playwright/test';

test.describe('Unique data', () => {
  test('uses Date.now for ids', async ({ page }) => {
    const id = Date.now();
    await page.goto('/items');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('Name').fill(`item-${id}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`item-${id}`)).toBeVisible();
  });
});
