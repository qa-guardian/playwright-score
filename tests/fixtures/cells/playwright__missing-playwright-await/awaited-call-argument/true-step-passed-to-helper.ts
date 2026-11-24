import { test, expect } from '@playwright/test';

async function whenDone(work: Promise<void>): Promise<void> {
  await work;
}

test('settings link', async ({ page }) => {
  await page.goto('/');
  // The step reaches the helper through a type-only wrapper, so it is reported and moves.
  await whenDone(test.step('open settings', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
  }) as Promise<void>);
});
