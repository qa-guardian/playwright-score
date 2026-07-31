import { test, expect } from '@playwright/test';

test.describe('Raw locators', () => {
  test('mostly CSS selectors', async ({ page }) => {
    await page.goto('/app');
    await page.locator('#main').click();
    await page.locator('.nav-item').click();
    await page.locator('div.container > button.submit').click();
    await page.locator('.footer a').click();
    await page.getByRole('heading').first();
    await expect(page.locator('.status')).toHaveText('ok');
  });
});
