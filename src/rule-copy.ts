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
    why: 'A fixed delay is either too short and the test flakes, or too long and every run wastes time.',
    fix: 'Replace waitForTimeout() with a web-first assertion such as expect(locator).toBeVisible().',
  },
  'playwright/no-networkidle': {
    title: 'Waiting for the network to go quiet',
    why: 'Pages with polling, analytics or websockets never go idle, so this wait is slow and unreliable.',
    fix: 'Wait for the specific element or response the test needs instead of networkidle.',
  },
  'playwright/no-force-option': {
    title: 'Click forced past a blocking element',
    why: 'force: true skips the checks a real user is subject to, so it can hide a genuinely broken page.',
    fix: 'Remove { force: true } and fix what is covering the element, or wait for it to be actionable.',
  },
  'playwright/no-wait-for-selector': {
    title: 'Legacy selector wait',
    why: 'waitForSelector is a manual wait that locators and assertions already do automatically.',
    fix: 'Use a locator with an expect(...).toBeVisible() assertion in place of waitForSelector.',
  },
  'playwright/no-wait-for-navigation': {
    title: 'Deprecated navigation wait',
    why: 'waitForNavigation races with the action that triggers it and is deprecated by Playwright.',
    fix: 'Assert on the new URL or page content with expect(page).toHaveURL() instead.',
  },
  'playwright/missing-playwright-await': {
    title: 'Playwright call that is never awaited',
    why: 'Without await the step runs in the background, so the test can pass before the check has happened or fail at random.',
    fix: 'Add await to every Playwright action and expect() call that returns a promise.',
  },
  'playwright/no-element-handle': {
    title: 'Element handle instead of a locator',
    why: 'Handles go stale when the page re-renders and do not retry, which causes intermittent failures.',
    fix: 'Replace $() and $$() handles with page.locator() or role-based locators.',
  },
  'playwright/no-eval': {
    title: 'Page code evaluated inside the test',
    why: 'Reading the DOM with $eval skips auto-waiting and checks a snapshot that may already be out of date.',
    fix: 'Use locator assertions such as toHaveText() or toHaveValue() in place of $eval.',
  },
  'playwright/no-conditional-in-test': {
    title: 'Test logic that branches',
    why: 'An if inside a test means different runs can check different things, so a pass does not mean the same thing twice.',
    fix: 'Split the branches into separate tests or use test.skip(condition, reason).',
  },
  'playwright/no-conditional-expect': {
    title: 'Assertion that only sometimes runs',
    why: 'An expect inside a condition can be skipped silently, so the test may pass without checking anything.',
    fix: 'Move the expect out of the condition so it always runs.',
  },
  'playwright/no-page-pause': {
    title: 'Debugger pause left in a test',
    why: 'page.pause() stops a run and hangs forever in CI.',
    fix: 'Delete page.pause() calls before committing.',
  },
  'playwright/no-useless-await': {
    title: 'await on something that is not a promise',
    why: 'It is harmless at runtime but signals that the author was unsure what is asynchronous.',
    fix: 'Remove await from synchronous calls such as locator() and getByRole().',
  },
  'playwright/expect-expect': {
    title: 'Test with no assertion',
    why: 'A test that checks nothing passes even when the feature is broken.',
    fix: 'Add at least one expect() that proves the outcome the test is named for.',
  },
  'playwright/prefer-web-first-assertions': {
    title: 'Assertion that does not retry',
    why: 'Checking a value once, instead of with a retrying assertion, fails whenever the page is a moment slow.',
    fix: 'Use await expect(locator).toBeVisible() or toHaveText() in place of expect(await locator.isVisible()).',
  },
  'playwright/valid-expect': {
    title: 'Malformed expect() call',
    why: 'An expect() with no matcher, or one that is never awaited, does not check anything.',
    fix: 'Complete each expect() with a matcher and await it.',
  },
  'playwright/no-standalone-expect': {
    title: 'Assertion outside any test',
    why: 'An expect outside a test or hook runs at load time and fails with a confusing error.',
    fix: 'Move the expect inside a test() or a hook.',
  },
  'playwright/no-raw-locators': {
    title: 'CSS or XPath locator',
    why: 'Selectors tied to markup break whenever the layout or class names change, and say nothing about what the user sees.',
    fix: 'Use getByRole, getByLabel or getByTestId so locators follow what the user sees.',
  },
  'playwright/prefer-native-locators': {
    title: 'Generic locator where a built-in one exists',
    why: 'Built-in locators read as user intent and survive markup changes better.',
    fix: 'Switch locator("text=...") style calls to getByText, getByRole or getByLabel.',
  },
  'playwright/prefer-locator': {
    title: 'Page method used where a locator is better',
    why: 'Locators retry and are reusable; page-level helpers do neither.',
    fix: 'Create a locator and call the action on it.',
  },
  'playwright/no-focused-test': {
    title: 'Focused test left in (test.only)',
    why: 'test.only silently skips every other test in the run, so the suite looks green while most of it never ran.',
    fix: 'Remove .only and set forbidOnly: !!process.env.CI in the Playwright config.',
  },
  'pwscore/no-skipped-test-declaration': {
    title: 'Test that is switched off',
    why: 'A skipped test is a test nobody is checking, and it tends to stay skipped.',
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
    why: 'Huge files are slow to review, hard to shard and tend to hide shared state between tests.',
    fix: 'Split the file by feature so each spec stays readable.',
  },
  'pwscore/no-timer-sleep': {
    title: 'Sleep written as a timer',
    why: 'setTimeout or a sleep helper is a hard wait in disguise, with the same flakiness and cost.',
    fix: 'Replace the timer with an assertion on the state you are waiting for.',
  },
  'pwscore/no-coordinate-click': {
    title: 'Click at screen coordinates',
    why: 'Pixel positions break at a different viewport, zoom or layout (unless the target is a canvas).',
    fix: 'Click a locator instead of page.mouse.click(x, y), except on canvas surfaces.',
  },
  'pwscore/no-trivial-assertion': {
    title: 'Assertion that cannot fail',
    why: 'Something like expect(true).toBe(true) raises the assertion count without checking the app.',
    fix: 'Assert on real page state, such as a heading, URL or row count.',
  },
  'pwscore/no-soft-assertion-only-test': {
    title: 'Test with only soft assertions',
    why: 'Soft assertions record a failure but never stop the test, so a slip can go unnoticed if nothing hard follows.',
    fix: 'Keep soft assertions for extras and end the test with a hard expect().',
  },
  'pwscore/eslint-disable-comment': {
    title: 'Lint rule switched off with a comment',
    why: 'A disable comment hides a problem from the scorer and the next reviewer.',
    fix: 'Fix the code the comment is hiding, or justify the exception in review.',
  },
  'playwright-score/parse-error': {
    title: 'File that could not be parsed',
    why: 'The file has a syntax error, so none of its tests could be checked or run.',
    fix: 'Fix the syntax error and re-run the score.',
  },
};

export const FALLBACK_COPY: RuleCopy = {
  title: 'Other quality issue',
  why: 'The scorer flagged this pattern as a quality risk.',
  fix: 'Review the flagged lines and simplify them.',
};

export function copyFor(rule: string): RuleCopy {
  return RULE_COPY[rule] ?? FALLBACK_COPY;
}
