import { test, expect } from '@playwright/test';

test('search box drops the old query', async ({ page }) => {
  await page.goto('/catalog');
  await page.locator('input[type=search]').fill('lamp');
  await page.getByRole('link', { name: 'All products' }).click();
  await expect(page.locator('input[type=search]')).not.toContainText('lamp');
});
