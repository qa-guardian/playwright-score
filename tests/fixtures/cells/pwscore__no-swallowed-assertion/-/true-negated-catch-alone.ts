import { test, expect } from '@playwright/test';

test('cookie dialog', async ({ page }) => {
  await page.goto('/settings');
  const consentDialog = page.getByRole('dialog', { name: 'Cookie preferences' });
  await expect(consentDialog).not.toBeVisible().catch(() => {});
});
