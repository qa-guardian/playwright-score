/**
 * Plain-English copy for every rule in profiles.ts ESLINT_RULE_MAP: a short
 * title, one sentence on why it matters, and one imperative fix used by the
 * report's "What to do next". tests/report.test.ts fails if a rule in the
 * map has no entry here.
 */
export interface RuleCopy {
  title: string;
  why: string;
  fix: string;
}

export const RULE_COPY: Record<string, RuleCopy> = {
  'playwright/no-wait-for-timeout': {
    title: 'Fixed pause before continuing',
    why: 'Fixed delays make runs slower and can cause random red builds, so engineers re-run pipelines and learn to ignore failures.',
    fix: 'Replace waitForTimeout() with a web-first assertion such as expect(locator).toBeVisible().',
  },
  'playwright/no-networkidle': {
    title: 'Waiting for the network to go quiet',
    why: 'Pages that keep polling or streaming never go quiet, so tests that wait for it can time out at random and hold up releases without a real defect.',
    fix: 'Wait for the specific element or response the test needs instead of networkidle.',
  },
  'playwright/no-force-option': {
    title: 'Click forced past a blocking element',
    why: 'Forcing a click bypasses what a real user is blocked by, so a broken or covered button can ship with a green build.',
    fix: 'Remove { force: true } and fix what is covering the element, or wait for it to be actionable.',
  },
  'playwright/no-wait-for-selector': {
    title: 'Legacy selector wait',
    why: 'Manual waits add delay and random failures that locators already handle, so CI is slower and less trusted.',
    fix: 'Use a locator with an expect(...).toBeVisible() assertion in place of waitForSelector.',
  },
  'playwright/no-wait-for-navigation': {
    title: 'Deprecated navigation wait',
    why: 'This wait can miss the navigation it is waiting for, which causes random failures that block releases.',
    fix: 'Assert on the new URL or page content with expect(page).toHaveURL() instead.',
  },
  'playwright/missing-playwright-await': {
    title: 'Playwright call that is never awaited',
    why: 'The test can finish before the step runs, so it passes while the feature is broken or fails at random.',
    fix: 'Add await to every Playwright action and expect() call that returns a promise.',
  },
  'playwright/no-element-handle': {
    title: 'Element handle instead of a locator',
    why: 'Stale handles can fail after the page re-renders, which can show up as random red builds nobody can reproduce.',
    fix: 'Replace $() and $$() handles with page.locator() or role-based locators.',
  },
  'playwright/no-eval': {
    title: 'Page code evaluated inside the test',
    why: 'It checks a snapshot that may be out of date, so a test can pass or fail for reasons unrelated to the product.',
    fix: 'Use locator assertions such as toHaveText() or toHaveValue() in place of $eval.',
  },
  'playwright/no-conditional-in-test': {
    title: 'Test logic that branches',
    why: 'Different runs can check different things, so a green build does not reliably mean the feature works.',
    fix: 'Split the branches into separate tests or use test.skip(condition, reason).',
  },
  'playwright/no-conditional-expect': {
    title: 'Assertion that only sometimes runs',
    why: 'The check can be skipped silently, so a broken feature can still go out under a green build.',
    fix: 'Move the expect out of the condition so it always runs.',
  },
  'playwright/no-page-pause': {
    title: 'Debugger pause left in a test',
    why: 'It halts the run until someone intervenes, so the CI job hangs and holds up the release pipeline.',
    fix: 'Delete page.pause() calls before committing.',
  },
  'playwright/no-useless-await': {
    title: 'await on something that is not a promise',
    why: 'It is harmless at runtime but signals that the author was unsure what is asynchronous.',
    fix: 'Remove await from synchronous calls such as locator() and getByRole().',
  },
  'playwright/expect-expect': {
    title: 'Test with no assertion',
    why: 'A test with no check passes even when the feature is broken, so a green build can hide a real outage.',
    fix: 'Add at least one expect() that checks the outcome the test is named for.',
  },
  'playwright/prefer-web-first-assertions': {
    title: 'Assertion that does not retry',
    why: 'A one-shot check can fail when the page is a moment slow, so the build goes red without a real defect.',
    fix: 'Use await expect(locator).toBeVisible() or toHaveText() in place of expect(await locator.isVisible()).',
  },
  'playwright/valid-expect': {
    title: 'Malformed expect() call',
    why: 'An incomplete check verifies nothing, so a broken feature can ship while the test reports success.',
    fix: 'Complete each expect() with a matcher and await it.',
  },
  'playwright/no-standalone-expect': {
    title: 'Assertion outside any test',
    why: 'It runs at load time and fails the whole run with a confusing error, which costs engineers time to diagnose.',
    fix: 'Move the expect inside a test() or a hook.',
  },
  'playwright/no-raw-locators': {
    title: 'CSS or XPath locator',
    why: 'Selectors tied to CSS or XPath can break on a redesign, so a UI change can mean unplanned test maintenance.',
    fix: 'Use getByRole, getByLabel or getByTestId so locators follow what the user sees.',
  },
  'playwright/prefer-native-locators': {
    title: 'Generic locator where a built-in one exists',
    why: 'Selectors tied to markup can break on redesigns, so UI changes can turn into test-maintenance work.',
    fix: 'Switch locator("text=...") style calls to getByText, getByRole or getByLabel.',
  },
  'playwright/prefer-locator': {
    title: 'Page method used where a locator is better',
    why: 'Page-level helpers do not retry, so tests can fail on slow pages and need hand-fixing.',
    fix: 'Create a locator and call the action on it.',
  },
  'playwright/no-focused-test': {
    title: 'Focused test left in (test.only)',
    why: 'test.only silently skips every other test in the run, so the build can look green while most of the suite never ran.',
    fix: 'Remove .only and set forbidOnly: !!process.env.CI in the Playwright config.',
  },
  'pwscore/no-skipped-test-declaration': {
    title: 'Test that is switched off',
    why: 'A skipped test protects nothing, and skipped tests tend to stay skipped, so coverage quietly shrinks.',
    fix: 'Fix and re-enable each skipped test, or delete it.',
  },
  'playwright/max-nested-describe': {
    title: 'Deeply nested describe blocks',
    why: 'Deep nesting makes test names and shared setup hard to follow.',
    fix: 'Flatten describe blocks to at most two levels.',
  },
  'playwright/require-top-level-describe': {
    title: 'Tests outside a describe block',
    why: 'Grouping tests by feature keeps reports and failures easy to read.',
    fix: 'Wrap related tests in a top-level test.describe() named for the feature.',
  },
  'metrics/oversized-file': {
    title: 'Very large spec file',
    why: 'Huge files are slow to review and shard, and hide shared state, so failures are harder to trace and fix.',
    fix: 'Split the file by feature so each spec stays readable.',
  },
  'pwscore/no-timer-sleep': {
    title: 'Sleep written as a timer',
    why: 'A timer is a fixed delay in disguise: it slows runs and can cause random red builds.',
    fix: 'Replace the timer with an assertion on the state you are waiting for.',
  },
  'pwscore/no-coordinate-click': {
    title: 'Click at screen coordinates',
    why: 'Pixel positions can break at another screen size or layout, so the test can fail when nothing is wrong with the product.',
    fix: 'Click a locator instead of page.mouse.click(x, y), except on canvas surfaces.',
  },
  'pwscore/no-trivial-assertion': {
    title: 'Assertion that cannot fail',
    why: 'It inflates the number of checks without checking the product, so coverage looks better than it is.',
    fix: 'Assert on real page state, such as a heading, URL or row count.',
  },
  'pwscore/eslint-disable-comment': {
    title: 'Lint rule switched off with a comment',
    why: 'A disable comment hides a problem from reviewers and from this score, so known issues stay unfixed.',
    fix: 'Fix the code the comment is hiding, or justify the exception in review.',
  },
  'pwscore/no-unawaited-action': {
    title: 'Click or navigation that is not awaited',
    why: 'The test moves on before the action finishes, so it can fail at random or pass without the step having happened, and real regressions hide behind the noise.',
    fix: 'Add await in front of the action.',
  },
  'pwscore/no-brittle-selector': {
    title: 'Selector tied to page layout',
    why: 'A cosmetic redesign can break the test even though the product still works, which costs engineering time on false alarms.',
    fix: 'Use a role, label or test id the page owner keeps stable.',
  },
  'pwscore/no-shared-mutable-state': {
    title: 'Tests that depend on each other through shared state',
    why: 'One failure or a changed run order can make later tests fail for the wrong reason, so a failure report points at the wrong feature.',
    fix: 'Create the data each test needs inside that test or in a fixture.',
  },
  'pwscore/serial-mode-dependency': {
    title: 'Tests that must run in order',
    why: 'One failing step skips every test after it, so a single bug can hide the state of the rest of the flow.',
    fix: 'Make each test independent, or keep serial mode only where the flow truly needs it.',
  },
  'pwscore/no-excessive-timeout': {
    title: 'Very long timeout',
    why: 'A long timeout hides slow or hung pages and makes a broken release take many minutes to be reported.',
    fix: 'Remove the long timeout and fix the slow step, or wait for a specific condition.',
  },
  'pwscore/no-fixme-test': {
    title: 'Test switched off with fixme',
    why: 'The feature it covers has no automated check, so a regression there can ship unnoticed.',
    fix: 'Fix and re-enable the test, or delete it and track the gap in the backlog.',
  },
  'pwscore/no-swallowed-assertion': {
    title: 'Assertion whose failure is ignored',
    why: 'A failing check is caught and dropped, so the test passes while the feature may be broken. Deliberate soft checks are the usual exception.',
    fix: 'Let the failure fail the test, or use expect.soft if the check is optional.',
  },
  'pwscore/no-weak-assertion': {
    title: 'Assertion that can never fail',
    why: 'The check passes whatever the page shows, so the test gives false confidence that the feature works.',
    fix: 'Assert on a concrete value, such as an exact count, text or URL.',
  },
  'pwscore/no-unawaited-expect-value': {
    title: 'Missing await inside an assertion',
    why: 'The assertion compares a pending promise instead of the page value, so it can pass or fail without checking the feature.',
    fix: 'Add await, or use a web-first assertion such as toHaveText.',
  },
  'pwscore/no-self-fulfilling-fallback': {
    title: 'Test fills in the value it then checks',
    why: 'If the page is missing the value, the test types it in and then confirms it, so the check passes on a broken feature.',
    fix: 'Remove the fallback and assert on what the page shows.',
  },
  'playwright-score/assertion-unverified': {
    title: 'Test whose checks we could not see',
    why: 'The checks probably live in a helper the score cannot read, so a person should confirm the test really verifies the page.',
    fix: 'Confirm the helper really asserts, or add an expect() to the test itself.',
  },
  'playwright-score/parse-error': {
    title: 'File that could not be parsed',
    why: 'The file cannot run, so none of its tests protect the product until the syntax error is fixed.',
    fix: 'Fix the syntax error and re-run the score.',
  },
};

export const FALLBACK_COPY: RuleCopy = {
  title: 'Other quality issue',
  why: 'This pattern often makes tests less reliable.',
  fix: 'Review the flagged lines and simplify them.',
};

export function copyFor(rule: string): RuleCopy {
  return RULE_COPY[rule] ?? FALLBACK_COPY;
}
