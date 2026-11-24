import { test } from '@playwright/test';
import { openBilling } from './billing-nav';

test('opens the invoices', async ({ page }) => {
  await openBilling(page);
});
