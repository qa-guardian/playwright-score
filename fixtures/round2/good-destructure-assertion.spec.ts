import { test } from '@playwright/test';
import { pw } from './unreadable-objects';

// Fixture: the assertion-like call sits on a name bound by destructuring.
test('destructured object and array patterns', async () => {
  const { channelsPage } = await pw.testBrowser.login('u');
  await channelsPage.toBeVisible();
  const [first] = await pw.pages.all();
  await first.toHaveTitle('Home');
});
