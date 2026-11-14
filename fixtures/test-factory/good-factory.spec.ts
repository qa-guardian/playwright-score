import { expect } from '@playwright/test';
import { testWithConfig, testWithOther } from './fixtures';

const t = testWithConfig({ locale: 'en' });
const u = testWithOther({ locale: 'de' });

t('first test through a factory', async ({ page, seed }) => {
  await page.goto('https://example.com');
  await expect(page.getByText(seed)).toBeVisible();
});

u('second test through a nested factory', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.getByRole('heading')).toBeVisible();
});
