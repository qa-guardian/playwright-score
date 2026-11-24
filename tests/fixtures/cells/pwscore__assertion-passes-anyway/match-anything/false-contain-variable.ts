import { test, expect } from '@playwright/test';

for (const city of ['Lyon', 'Porto']) {
  test(`shows ${city}`, async ({ page }) => {
    await page.goto(`/stores?city=${city}`);
    await expect(page.getByRole('list')).toContainText(city);
  });
}
