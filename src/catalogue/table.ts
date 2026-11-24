import type { RuleRow } from './types.js';
import { passesRegardlessRows } from './passes-regardless.js';
import { flakeRiskRows } from './flake-risk.js';
import { flakeRiskAdvisoryRows } from './flake-risk-advisory.js';
import { suiteRows } from './suite.js';
import { maintainabilityRows } from './maintainability.js';
import { receiverUnresolvedRows } from './receiver-unresolved.js';
import { foreignExpectRows } from './foreign-expect.js';
import { apiUnderTestRows } from './api-under-test.js';
import { readCatalogueJson } from './data.js';

export type { Basis, CellStats, Design, Evidence, Family, RuleRow, Tier, VerdictCounts } from './types.js';
export { cellKey, cellStats, cellTier, precisionFile } from './precision.js';
export { tierOf, confidenceOfRow, MIN_DECIDED } from './tiers.js';

/** Every cell, in a fixed order. The first row of a rule is its default form. */
export const ROWS: readonly RuleRow[] = [
  ...passesRegardlessRows,
  ...flakeRiskRows,
  ...flakeRiskAdvisoryRows,
  ...suiteRows,
  ...maintainabilityRows,
  ...receiverUnresolvedRows,
  ...foreignExpectRows,
  ...apiUnderTestRows,
];

const byCell = new Map<string, RuleRow>();
const byRule = new Map<string, RuleRow>();
for (const row of ROWS) {
  byCell.set(`${row.rule}|${row.form}`, row);
  if (!byRule.has(row.rule)) byRule.set(row.rule, row);
}

/** The row for a rule and form, or undefined when the table has no such cell. */
export function rowFor(rule: string, form: string): RuleRow | undefined {
  return byCell.get(`${rule}|${form}`);
}

/** The first (default) row of a rule. */
export function defaultRow(rule: string): RuleRow | undefined {
  return byRule.get(rule);
}

/** Every row of a rule, in catalogue order. */
export function rowsOf(rule: string): RuleRow[] {
  return ROWS.filter((r) => r.rule === rule);
}

/** Rule ids in catalogue order. */
export function catalogueRules(): string[] {
  return [...byRule.keys()];
}

/** Every documentation URL a finding may carry. */
export const DOCS_URLS: readonly string[] = readCatalogueJson<string[]>('docs-urls.json');

/** Packages whose calls the test-state analysis may treat as known. */
export const KNOWN_PACKAGES = readCatalogueJson<{ assertion: string[]; nonAsserting: string[] }>('known-packages.json');
