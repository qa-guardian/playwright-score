import type { RuleRow } from './types.js';
import { flakeRiskRows } from './flake-risk.js';
import { suiteRows } from './suite.js';

/**
 * Rules about APIs the Playwright docs discourage for people who use Playwright
 * (QAG-287 S3c). A project that implements Playwright calls these APIs in its own
 * tests on purpose, so a finding of one of these rules in such a project is still
 * reported, with form `api-under-test`. One entry per line.
 */
export const API_UNDER_TEST_RULES: readonly string[] = [
  'playwright/no-networkidle',
  'playwright/no-wait-for-selector',
  'playwright/no-wait-for-navigation',
  'playwright/no-element-handle',
  'playwright/no-page-pause',
];

/** Form of a discouraged-API finding inside a project that is the Playwright implementation. */
export const API_UNDER_TEST_FORM = 'api-under-test';

/** Package names that say the scanned project is the Playwright implementation. */
export const PLAYWRIGHT_PACKAGE_NAMES: readonly string[] = ['playwright', 'playwright-core', '@playwright/test'];

/** Copy for the `api-under-test` form. It never says the test is wrong. */
export const API_UNDER_TEST_COPY: Pick<RuleRow, 'title' | 'what' | 'why' | 'fix'> = {
  title: 'Discouraged API called by a Playwright package',
  what: 'This line calls an API the Playwright docs discourage, and the scanned project is itself a Playwright package.',
  why: 'The docs discourage this API for people who use Playwright. A project that implements it has to call it in its own tests.',
  fix: 'Nothing to change if this test exercises the API on purpose.',
};

/** The `api-under-test` cell of each rule: the rule's own row with the neutral copy, advisory by design. */
export const apiUnderTestRows: readonly RuleRow[] = API_UNDER_TEST_RULES.map((rule) => {
  const base = [...flakeRiskRows, ...suiteRows].find((r) => r.rule === rule && r.form === '-');
  if (!base) throw new Error(`api-under-test rule ${rule} has no catalogue row`);
  const { cls: _cls, docsSentence: _docsSentence, ...rest } = base;
  return { ...rest, form: API_UNDER_TEST_FORM, design: 'advisory', bcEligible: false, ...API_UNDER_TEST_COPY };
});
