const { test, expect } = require('@playwright/test');

test('promo scrolls into view', async ({ page }) => {
  await page.goto('/');
  const promo = await page.$('#promo');
  await page.evaluate((el) => el.scrollIntoView(), promo);
  await expect(page.getByRole('region', { name: 'Promo' })).toBeVisible();
});
