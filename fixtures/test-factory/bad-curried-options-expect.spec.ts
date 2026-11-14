import { expect } from '@playwright/test';
import { testWithConfig } from './fixtures';

testWithConfig({ locale: (expect(1).toBe(1), 'en') })('expect in the options object stays standalone', async ({ page }) => {
  await expect(page.getByRole('heading')).toBeVisible();
});
