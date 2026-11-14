import { test } from './fixtures';
import { LoginPage } from './pages/login-page';

// Fixture: the `login` fixture asserts in its SETUP only. That does not make
// an unrelated page-object method named `login` an assertion helper.
test('no assert at all', async ({ page }) => {
  const lp = new LoginPage(page);
  await lp.login('x');
});
