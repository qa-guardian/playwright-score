import { test, expect } from '@playwright/test';

test('structure-coupled selectors', async ({ page }) => {
  await page.locator('//div[@id="app"]/ul/li[3]').click();
  await page.locator('ul > li:nth-child(2) a').click();
  await page.locator('div > section > article > div > span > a').click();
  await page.locator('.css-1a2b3c').click();
  await page.locator('.MuiBox-root-12').click();
  await page.locator('.row').first().click();
  await expect(page.locator('.item').nth(2)).toBeVisible();
});
