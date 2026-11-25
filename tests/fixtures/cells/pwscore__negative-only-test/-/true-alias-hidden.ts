import { test, expect } from '@playwright/test';

test('pressing Escape closes the picker', async ({ page }) => {
  const picker = page.getByRole('listbox', { name: 'Seed variety' });
  await page.goto('/garden/beds/4');
  await page.getByLabel('Seed variety').press('Escape');
  await expect(picker).toBeHidden();
});
