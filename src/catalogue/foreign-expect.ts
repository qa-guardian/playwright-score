import type { RuleRow } from './types.js';
import { passesRegardlessRows } from './passes-regardless.js';
import { flakeRiskRows } from './flake-risk.js';

/**
 * Rules that describe how Playwright's `expect` behaves (QAG-287 S4b). A finding of
 * one of them is about an `expect` call, so it depends on where that `expect` comes
 * from. The last two rules are built by later slices; a rule without a catalogue row
 * has no cell yet. One entry per line.
 */
export const EXPECT_BOUND_RULES: readonly string[] = [
  'playwright/missing-playwright-await',
  'playwright/valid-expect',
  'pwscore/no-unawaited-expect-value',
  'pwscore/no-weak-assertion',
  'pwscore/no-trivial-assertion',
  'playwright/prefer-web-first-assertions',
  'pwscore/no-floating-callback-assertion',
  'pwscore/assertion-passes-anyway',
];

/** Form of a finding whose `expect` or `assert` is proven to come from another assertion library. */
export const FOREIGN_EXPECT_FORM = 'foreign-expect';

/** Copy for the `foreign-expect` form. It never says the test is wrong. */
export const FOREIGN_EXPECT_COPY: Pick<RuleRow, 'title' | 'what' | 'why' | 'fix'> = {
  title: 'Assertion from another library',
  what: 'This line matches a rule about Playwright assertions, but its expect or assert is imported from another assertion library.',
  why: 'The rule describes how the expect of Playwright behaves. Another library follows its own rules, so the pattern may be correct here.',
  fix: 'Nothing to change if the other library is intended. For checks on the page, use expect from @playwright/test.',
};

/**
 * Expect-bound rules with no `foreign-expect` cell (QAG-287 S7a): their finding on a proven foreign `expect` is
 * dropped, not re-formed (src/expect-binding.ts, dropForeignWithoutCell).
 */
export const NO_FOREIGN_EXPECT_CELL: readonly string[] = ['pwscore/no-floating-callback-assertion'];

/** The `foreign-expect` cell of every expect-bound rule that has a row: the rule's first row with the neutral copy, advisory by design. */
export const foreignExpectRows: readonly RuleRow[] = EXPECT_BOUND_RULES.filter((rule) => !NO_FOREIGN_EXPECT_CELL.includes(rule)).flatMap((rule) => {
  const base = [...passesRegardlessRows, ...flakeRiskRows].find((r) => r.rule === rule);
  if (!base) return [];
  const { cls: _cls, docsSentence: _docsSentence, ...rest } = base;
  return [{ ...rest, form: FOREIGN_EXPECT_FORM, design: 'advisory', bcEligible: false, ...FOREIGN_EXPECT_COPY }];
});
