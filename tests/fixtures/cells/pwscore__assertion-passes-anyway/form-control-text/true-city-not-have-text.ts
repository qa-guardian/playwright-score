import { test, expect } from '@playwright/test';

test('city is not kept after a reset', async ({ page }) => {
  await page.goto('/checkout/address');
  await page.locator('input[type=text][name=city]').fill('Springfield');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('input[type=text][name=city]')).not.toHaveText('Springfield');
});
