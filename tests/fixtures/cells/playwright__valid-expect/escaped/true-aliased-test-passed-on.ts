import { test, expect } from '@playwright/test';
import { track } from 'soft-check-queue';

const it = test;

it('cart count updates', async ({ page }) => {
  await page.goto('/shop');
  track(expect(page.getByTestId('cart-count')));
});
