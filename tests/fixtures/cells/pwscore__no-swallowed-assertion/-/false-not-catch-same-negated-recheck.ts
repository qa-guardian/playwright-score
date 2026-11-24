import { test, expect } from '@playwright/test';

test('cookie dialog closes', async ({ page }) => {
  await page.goto('/settings');
  const consentDialog = page.getByRole('dialog', { name: 'Cookie preferences' });
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(consentDialog).not.toBeVisible({ timeout: 2000 }).catch(() => {});
  await expect(consentDialog).not.toBeVisible();
});
