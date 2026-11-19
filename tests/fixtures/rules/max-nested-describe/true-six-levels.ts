import { test, expect } from '@playwright/test';

test.describe('a', () => {
  test.describe('b', () => {
    test.describe('c', () => {
      test.describe('d', () => {
        test.describe('e', () => {
          test.describe('f', () => {
            test('cart page', async ({ page }) => {
              await page.goto('/cart');
              await expect(page.getByRole('heading')).toBeVisible();
            });
          });
        });
      });
    });
  });
});
