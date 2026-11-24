import { test, expect } from '@playwright/test';

test('dialog closes', async ({ page }) => {
  const view = page;
  await view.goto('/account');
  await view.getByRole('button', { name: 'Close' }).click();
  await view.getByRole('dialog').isHidden();
});
