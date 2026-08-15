import { test, expect } from '@playwright/test';

test.describe('legacy selector-string actions', () => {
  test('uses page.click/page.type with raw selectors instead of locators', async ({ page }) => {
    await page.goto('/login');
    await page.click('#username');
    await page.type('#username', 'demo@example.com');
    await page.click('body > div > form > button.submit-btn');
    await expect(page.getByText('Welcome')).toBeVisible();
  });
});
