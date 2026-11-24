const { test, expect } = require('@playwright/test');

test('legacy api surface from a script file', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#order-list');
  await Promise.all([page.waitForNavigation(), page.getByRole('link', { name: 'Invoice' }).click()]);
  const cells = await page.$$('td');
  expect(cells.length).toBe(4);
  await page.pause();
});
