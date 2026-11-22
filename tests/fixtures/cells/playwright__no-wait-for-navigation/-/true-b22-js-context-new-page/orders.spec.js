import { test } from '@playwright/test';

test('orders table loads', async ({ context }) => {
  const tabPage = await context.newPage();
  await tabPage.waitForNavigation();
});
