import { test, expect } from '@playwright/test';

async function logged(check: Promise<void>): Promise<void> {
  await check;
}

test('sign-in form', async ({ page }) => {
  await page.goto('/sign-in');
  const check = () => logged(expect(page.getByLabel('Email')).toBeEditable());
  await check();
});
