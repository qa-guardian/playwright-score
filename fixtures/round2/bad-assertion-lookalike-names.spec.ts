import { test } from '@playwright/test';
import { user, helper, api, shop, loginPage } from './unreadable-objects';

// Fixture: calls on objects this scan cannot read whose names merely
// contain or start like an assertion word, or are Playwright actions.
test('built-in constructor', async () => {
  console.log(new Date().toISOString());
});
test('string method', async () => {
  console.log(user.email.toLowerCase());
});
test('toString', async () => {
  console.log(helper.toString());
});
test('toJSON', async () => {
  console.log(api.payload.toJSON());
});
test('checkout is not check', async () => {
  await shop.checkout();
});
test('locator held in a property', async () => {
  await loginPage.rememberMe.check();
});
