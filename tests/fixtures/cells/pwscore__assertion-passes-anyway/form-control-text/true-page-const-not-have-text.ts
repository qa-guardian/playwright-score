import { test, expect } from '@playwright/test';

test('phone is not prefilled', async ({ page }) => {
  const view = page;
  await view.goto('/profile/edit');
  await expect(view.locator('input[type=tel][name=phone]')).not.toHaveText('555-0100');
});
