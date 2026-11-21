import { test, expect } from '@playwright/test';
import { DetailsPage } from './details-page';

test('opens details', async ({ page }) => {
  const detailsPage = new DetailsPage(page);
  await page.goto('/items/1');
  await detailsPage.waitForNavigation();
  await expect(page).toHaveURL(/details/);
});
