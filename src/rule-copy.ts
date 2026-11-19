/**
 * Plain-English copy for every rule in profiles.ts ESLINT_RULE_MAP: a short
 * title, one sentence on why it matters, and one imperative fix used by the
 * report's "What to do next". tests/report.test.ts fails if a rule in the
 * map has no entry here.
 */
import { catalogueRules, defaultRow } from './catalogue/table.js';

export interface RuleCopy {
  title: string;
  why: string;
  fix: string;
}

/** Plain-English copy per rule, read from the catalogue (src/catalogue). */
export const RULE_COPY: Record<string, RuleCopy> = Object.fromEntries(
  catalogueRules()
    .map((rule) => defaultRow(rule)!)
    .filter((row) => !row.noLegacyCopy)
    .map((row) => [row.rule, { title: row.title, why: row.why, fix: row.fix }])
);

export const FALLBACK_COPY: RuleCopy = {
  title: 'Other quality issue',
  why: 'This pattern often makes tests less reliable.',
  fix: 'Review the flagged lines and simplify them.',
};

export function copyFor(rule: string): RuleCopy {
  return RULE_COPY[rule] ?? FALLBACK_COPY;
}
