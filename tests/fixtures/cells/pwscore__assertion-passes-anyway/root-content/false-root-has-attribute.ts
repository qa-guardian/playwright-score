import { test, expect } from '@playwright/test';

test('language is set', async ({ page }) => {
  await page.goto('/fr/accueil');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
