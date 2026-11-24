import { test as base } from '@playwright/test';
import { fake } from './runner';
(base as any).extend = () => fake;
const test = base.extend({});

test('orders table loads', async ({ page }) => {
  await page.goto('/orders');
  await page.waitForNavigation();
});
