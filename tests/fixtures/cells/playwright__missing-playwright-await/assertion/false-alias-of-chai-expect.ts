import { test } from '@playwright/test';
import { expect as chaiExpect } from 'chai';

const check = chaiExpect;

test('alert after a failed login', async ({ page }) => {
  await page.goto('/login');
  check(page.getByRole('alert')).toBeVisible();
});
