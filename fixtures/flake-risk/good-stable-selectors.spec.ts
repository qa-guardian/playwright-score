import { test, expect } from '@playwright/test';

test('selectors that name what the user sees', async ({ page }) => {
  await page.getByRole('row').first().click();
  await page.getByTestId('item').nth(2).click();
  await page.locator('[data-testid="row"]').first().click();
  await page.locator('nav a.active').click();
  await page.locator('div.card > h2').click();
  await page.locator('text=Sign in now please').click();
  await page.locator('li:has(a.x b y z w)').click();
  await expect(page.locator('.item')).toHaveCount(3);
});
