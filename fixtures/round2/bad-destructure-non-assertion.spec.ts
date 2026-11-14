import { test } from '@playwright/test';
import { pw } from './unreadable-objects';

// Fixture: names bound by destructuring take the kind of the initializer,
// but a method that does not read like an assertion is still no assertion.
test('destructured, non-assertion call', async () => {
  const { channelsPage } = await pw.testBrowser.login('u');
  await channelsPage.open();
});
