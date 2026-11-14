import { expect } from '@playwright/test';
import { testWithConfig } from './fixtures';

testWithConfig({ locale: 'en' })('curried test from an imported factory', async ({ page, seed }) => {
  await page.goto('https://example.com');
  await expect(page.getByText(seed)).toBeVisible();
});

testWithConfig({ locale: 'de' }).only('curried only form', async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
});

testWithConfig({ locale: 'fr' }).skip('curried skip form', async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
});
