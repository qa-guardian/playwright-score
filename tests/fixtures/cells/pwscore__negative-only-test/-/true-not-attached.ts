import { test, expect } from '@playwright/test';

test('removing a filter chip detaches it', async ({ page }) => {
  await page.goto('/seeds?tag=annual');
  await page.getByRole('button', { name: 'Remove annual' }).click();
  await expect(page.getByTestId('chip-annual')).not.toBeAttached();
});
