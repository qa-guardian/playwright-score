import { test } from '@playwright/test';

test.describe('Not ready yet', () => {
  test.fixme('exercises the flow without asserting anything', async ({ page }) => {
    await page.goto('/wip');
    await page.getByRole('button', { name: 'Continue' }).click();
  });
});
