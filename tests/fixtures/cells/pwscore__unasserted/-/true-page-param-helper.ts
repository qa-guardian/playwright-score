import { test } from '@playwright/test';

async function openPricing(page) {
  await page.goto('/pricing');
  await page.getByRole('tab', { name: 'Yearly' }).click();
}

test('switches to yearly billing', async ({ page }) => {
  await openPricing(page);
});
