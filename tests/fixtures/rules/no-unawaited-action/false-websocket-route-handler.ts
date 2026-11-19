import { test, expect } from '@playwright/test';

test('cart page', async ({ page }) => {
  await page.routeWebSocket('wss://shop.example/live', (ws) => {
    ws.onMessage((message) => {
      ws.send(message);
    });
    ws.close();
  });
  await page.goto('/cart');
  await expect(page.getByRole('heading')).toBeVisible();
});
