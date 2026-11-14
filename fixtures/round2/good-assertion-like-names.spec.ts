import { test } from '@playwright/test';
import { app, rows } from './unreadable-objects';

// Fixture: names that do read like an assertion on an object this scan
// cannot read: the assertion may live there, so a human should check.
test('camelCase check helper', async () => {
  await app.checkInvoiceTotals();
});
test('matcher-like method', async () => {
  await rows.toHaveCount(3);
});
