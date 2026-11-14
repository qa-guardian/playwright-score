import { test } from '@acme/e2e-lib';

// Fixture: the test asserts through `pw.selectTeamPage.toBeVisible()`, a
// page-object method on a fixture injected by a package this scan cannot
// read. That is not provable either way: it is reported as a report-only
// "needs a human check" finding and never lowers the score.
test('signup lands on team selection', async ({ pw }) => {
  await pw.signupPage.submit();
  await pw.selectTeamPage.toBeVisible();
});
