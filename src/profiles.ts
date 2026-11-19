import type { DimensionName, ProfileName } from './types.js';
import { catalogueRules, defaultRow } from './catalogue/table.js';

/**
 * `strict` was planned for 1.1.0 (never published) to gate four
 * contentious rules behind an opt-in profile, report-only under
 * `standard`. 2.0.0 (model v4, see
 * CHANGELOG.md) scores all of them under `standard` directly — owner
 * direction: public scores should reflect quality, full stop, not be
 * softened to avoid moving anyone's number. With nothing left for a
 * second profile to gate (every rule now counts the same way regardless
 * of which profile runs), `strict` would be byte-for-byte identical to
 * `standard` — dead weight, not a real choice — so it's removed rather
 * than kept as a confusing no-op alias. `--profile strict` errors with a
 * migration message (see cli.ts); the library API falls back to
 * `standard` weights for any unrecognized profile string, same as the
 * `guardian` profile's removal in 1.0.0.
 */
export const PROFILE_WEIGHTS: Record<
  ProfileName,
  Partial<Record<DimensionName, number>>
> = {
  standard: {
    playwrightHygiene: 40,
    assertions: 25,
    locators: 20,
    structure: 15,
  },
};

export const DEFAULT_THRESHOLDS: Record<ProfileName, number> = {
  standard: 80,
};

/** Map eslint ruleId → dimension + whether report-only for scoring */
export interface RuleMapping {
  dimension: DimensionName;
  /** Override severity for scoring units; undefined keeps ESLint severity */
  severityOverride?: 'error' | 'warning' | 'info';
  reportOnly?: boolean;
}

/**
 * ESLint rule → dimension map, read from the catalogue (src/catalogue), which
 * holds the reasons each rule is report-only or demoted. Plugin rule ids
 * without a prefix are handled in the runner.
 */
export const ESLINT_RULE_MAP: Record<string, RuleMapping> = Object.fromEntries(
  catalogueRules()
    .map((rule) => defaultRow(rule)!)
    .filter((row) => !row.noMapping)
    .map((row): [string, RuleMapping] => [
      row.rule,
      {
        dimension: row.dimension,
        ...(row.severityOverride ? { severityOverride: row.severityOverride } : {}),
        ...(row.reportOnly ? { reportOnly: true } : {}),
      },
    ])
);

export function mapRule(ruleId: string): RuleMapping {
  if (ESLINT_RULE_MAP[ruleId]) return ESLINT_RULE_MAP[ruleId];
  if (ruleId.startsWith('playwright/')) {
    return { dimension: 'playwrightHygiene', severityOverride: 'warning' };
  }
  return { dimension: 'playwrightHygiene', severityOverride: 'info', reportOnly: true };
}
