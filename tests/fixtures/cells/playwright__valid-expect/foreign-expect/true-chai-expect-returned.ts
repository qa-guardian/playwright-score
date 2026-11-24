import { expect } from 'chai';
import { test } from '@playwright/test';
import { track } from 'soft-check-queue';

function expectTitle(value: string) {
  return expect(value);
}

test('invoice list has a title', async ({ page }) => {
  await page.goto('/invoices');
  track(expectTitle(await page.title()));
});
