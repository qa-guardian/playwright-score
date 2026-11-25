import { test, expect } from '@playwright/test';

test('closing the tour hides its popover', async ({ page }) => {
  const shop = page;
  const popover = shop.getByRole('dialog', { name: 'Welcome tour' });
  await shop.goto('/greenhouse');
  await shop.getByRole('button', { name: 'Skip tour' }).click();
  await expect(popover).not.toBeVisible();
});
