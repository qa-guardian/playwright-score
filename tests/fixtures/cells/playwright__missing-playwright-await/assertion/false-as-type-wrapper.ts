import { test, expect } from '@playwright/test';

async function track(check: unknown): Promise<void> {
  await check;
}

test('alert closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await track(expect(page.getByRole('alert')).toBeHidden() as Promise<void>);
});
