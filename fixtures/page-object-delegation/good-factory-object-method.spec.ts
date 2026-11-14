import { test } from '@playwright/test';
import { createEventFixture } from './event-fixture';

// Fixture: the assertion is an object-literal method of a factory in a
// readable imported file (the shape cal.com's eventTypePage fixture uses).
test('availability tab is shown', async ({ page }) => {
  const events = createEventFixture(page);
  await events.openEvents();
  await events.checkTabShown();
});
