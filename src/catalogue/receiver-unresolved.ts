import type { RuleRow } from './types.js';
import { flakeRiskRows } from './flake-risk.js';
import { suiteRows } from './suite.js';

/**
 * Rules whose findings are tiered by what the receiver of the call is (QAG-287 B2).
 *
 * Each of these rules reports a method by its name on something called `page` or
 * `frame`. A finding whose receiver is proven to be a Playwright Page or Frame keeps
 * the rule's `-` form. Any other finding is still reported, with form `unresolved`:
 * it is likely, never certain. One entry per line, so a rule can be taken out alone.
 */
export const RECEIVER_TIERED_RULES: readonly string[] = [
  'playwright/no-wait-for-selector',
  'playwright/no-wait-for-navigation',
  'playwright/no-element-handle',
  'playwright/no-page-pause',
];

type Copy = Pick<RuleRow, 'title' | 'what' | 'why' | 'fix'>;

/** Copy for the `unresolved` form. It never says the call is Playwright's, and the fix is conditional. */
const UNRESOLVED_COPY: Record<string, Copy> = {
  'playwright/no-wait-for-selector': {
    title: 'Possible legacy selector wait',
    what: 'The test calls waitForSelector() on an object the scorer could not confirm is a Playwright Page or Frame.',
    why: 'If this is a Playwright page, a manual wait adds delay and random failures that locators already handle.',
    fix: 'If this is a Playwright page, use a locator with an expect(...).toBeVisible() assertion in place of waitForSelector.',
  },
  'playwright/no-wait-for-navigation': {
    title: 'Possible deprecated navigation wait',
    what: 'The test calls waitForNavigation() on an object the scorer could not confirm is a Playwright Page or Frame.',
    why: 'If this is a Playwright page, this wait can miss the navigation it is waiting for, which causes random failures.',
    fix: 'If this is a Playwright page, assert on the new URL or page content with expect(page).toHaveURL() instead.',
  },
  'playwright/no-element-handle': {
    title: 'Possible element handle instead of a locator',
    what: 'The test calls $() or $$() on an object the scorer could not confirm is a Playwright Page or Frame.',
    why: 'If this is a Playwright page, the call returns a handle that can go stale after the page re-renders.',
    fix: 'If this is a Playwright page, replace $() and $$() with page.locator() or role-based locators.',
  },
  'playwright/no-page-pause': {
    title: 'Possible debugger pause left in a test',
    what: 'The test calls pause() on an object the scorer could not confirm is a Playwright Page.',
    why: 'If this is a Playwright page, the call halts the run until someone intervenes, so the CI job hangs.',
    fix: 'If this is a Playwright page, delete the pause() call before committing.',
  },
};

/** The `unresolved` cell of every receiver-tiered rule: the rule's own row with the conditional copy, likely by design. */
export const receiverUnresolvedRows: readonly RuleRow[] = RECEIVER_TIERED_RULES.map((rule) => {
  const base = [...flakeRiskRows, ...suiteRows].find((r) => r.rule === rule && r.form === '-');
  if (!base) throw new Error(`receiver-tiered rule ${rule} has no catalogue row`);
  const { cls: _cls, docsSentence: _docsSentence, ...rest } = base;
  return { ...rest, form: 'unresolved', design: 'likely', bcEligible: false, ...UNRESOLVED_COPY[rule] };
});
