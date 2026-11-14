import { expect } from '@playwright/test';
import { testWithConfig } from './fixtures';

testWithConfig({ locale: 'en' })('curried test is subject to our own rules', async ({ page }) => {
  page.goto('https://example.com');
  await expect(page.getByRole('heading')).toBeVisible();
});
