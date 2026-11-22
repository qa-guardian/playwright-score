import { test, _electron as electron } from '@playwright/test';

test('orders window loads', async () => {
  const app = await electron.launch({ args: ['main.js'] });
  const appPage = await app.firstWindow();
  await appPage.waitForNavigation();
});
