import { expect } from 'chai';
import { test } from '@playwright/test';

test('invoice list has a title', async ({ page }) => {
  await page.goto('/invoices');
  const heading = await page.title();
  expect(heading).to.be.ok;
});
