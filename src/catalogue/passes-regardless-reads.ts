import type { RuleRow } from './types.js';

/**
 * Passes-regardless rows of the read rules: `pwscore/unchecked-read` (N2) and `pwscore/loop-only-assertions` (N3).
 * Kept apart from passes-regardless.ts only to hold every catalogue file under 300 lines; `ROWS` spreads them
 * right after `passesRegardlessRows`, so the catalogue order is unchanged.
 */
export const passesRegardlessReadRows: readonly RuleRow[] = [
  // "locator.isVisible() does not wait for the element to become visible and returns immediately."
  // "If you need to assert that element is visible, prefer expect(locator).toBeVisible() to avoid flakiness."
  {
    rule: 'pwscore/unchecked-read',
    form: 'discarded',
    family: 'passes-regardless',
    design: 'likely',
    basis: 'docs',
    docs: 'https://playwright.dev/docs/api/class-locator#locator-is-visible',
    bcEligible: false,
    title: 'Visibility read that checks nothing',
    what: 'isVisible() or isHidden() is called on its own line and its result is thrown away.',
    why: 'The call returns at once and nothing looks at the answer, so the test passes whether the element is shown or not.',
    fix: 'Use await expect(locator).toBeVisible() or toBeHidden(), which waits for the state and fails the test when it is wrong.',
    dimension: 'assertions',
    label: 'medium',
  },
  // "To make an assertion, call expect(value) and choose a matcher that reflects the expectation."
  {
    rule: 'pwscore/unchecked-read',
    form: 'unused-binding',
    family: 'passes-regardless',
    design: 'likely',
    basis: 'docs',
    docs: 'https://playwright.dev/docs/test-assertions',
    bcEligible: false,
    title: 'Value read from the page and never checked',
    what: 'A test reads a value from the page, such as a text, a count, a state or an attribute, into a variable it never uses.',
    why: 'Nothing checks the value, so the test passes whatever the page shows.',
    fix: 'Assert on it, preferably with a web-first assertion on the locator such as toHaveText, toHaveCount or toHaveAttribute, or remove the read.',
    dimension: 'assertions',
    label: 'medium',
  },
  // N3: every assertion of a test sits in a loop over a list read without waiting (src/rules/loop-only-assertions.ts,
  // run by the test states on S12's assertion facts). Likely by design; report-only like pwscore/unasserted.
  {
    rule: 'pwscore/loop-only-assertions',
    form: '-',
    family: 'passes-regardless',
    design: 'likely',
    basis: 'docs',
    docs: 'https://playwright.dev/docs/api/class-locator#locator-all',
    bcEligible: false,
    title: 'Assertions only inside a loop over a list',
    what: 'Every assertion of the test is inside a loop over locator.all(), page.$$() or a count() range, and nothing before the loop checks that the list has items or waits for one.',
    why: 'locator.all() does not wait for elements: it returns whatever is on the page at that moment. If the list is empty, the loop runs zero times, nothing is checked and the test passes.',
    fix: 'Before the loop, assert the list itself, for example await expect(items).toHaveCount(3) or await expect(items.first()).toBeVisible().',
    dimension: 'assertions',
    severityOverride: 'info',
    reportOnly: true,
    label: 'medium',
    noMapping: true,
  },
];
