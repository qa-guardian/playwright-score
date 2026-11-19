import { test, expect } from '@playwright/test';
import { checkHeading } from './helpers';

test('cart page', async ({ page }) => {
  await page.goto('/cart');
  await checkHeading(page);
});
