import type { DimensionName, ProfileName } from './types.js';

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
  guardian: {
    playwrightHygiene: 30,
    assertions: 15,
    locators: 15,
    structure: 15,
    guardianConventions: 25,
  },
};

export const DEFAULT_THRESHOLDS: Record<ProfileName, number> = {
  standard: 80,
  guardian: 75,
};

/** Map eslint ruleId → dimension + whether report-only for scoring */
export interface RuleMapping {
  dimension: DimensionName;
  /** Override severity for scoring units; undefined keeps ESLint severity */
  severityOverride?: 'error' | 'warning' | 'info';
  reportOnly?: boolean;
}

/**
 * ESLint rule → dimension map (plugin rule ids without prefix handled in runner).
 */
export const ESLINT_RULE_MAP: Record<string, RuleMapping> = {
  // Hygiene
  'playwright/no-wait-for-timeout': { dimension: 'playwrightHygiene' },
  'playwright/no-networkidle': { dimension: 'playwrightHygiene' },
  'playwright/no-force-option': { dimension: 'playwrightHygiene' },
  'playwright/no-wait-for-selector': { dimension: 'playwrightHygiene' },
  'playwright/no-wait-for-navigation': { dimension: 'playwrightHygiene' },
  'playwright/missing-playwright-await': { dimension: 'playwrightHygiene' },
  'playwright/no-element-handle': { dimension: 'playwrightHygiene' },
  'playwright/no-eval': { dimension: 'playwrightHygiene' },
  'playwright/no-conditional-in-test': {
    dimension: 'playwrightHygiene',
    severityOverride: 'warning',
  },
  'playwright/no-conditional-expect': {
    dimension: 'playwrightHygiene',
    severityOverride: 'warning',
  },
  'playwright/no-page-pause': { dimension: 'playwrightHygiene' },
  'playwright/no-useless-await': {
    dimension: 'playwrightHygiene',
    severityOverride: 'warning',
  },

  // Assertions
  'playwright/expect-expect': { dimension: 'assertions' },
  'playwright/prefer-web-first-assertions': {
    dimension: 'assertions',
    severityOverride: 'warning',
  },
  'playwright/valid-expect': { dimension: 'assertions' },
  'playwright/no-standalone-expect': { dimension: 'assertions' },

  // Locators — findings for repair, reportOnly so ratio owns locators score
  'playwright/no-raw-locators': {
    dimension: 'locators',
    reportOnly: true,
    severityOverride: 'warning',
  },
  'playwright/prefer-native-locators': {
    dimension: 'locators',
    reportOnly: true,
    severityOverride: 'warning',
  },
  'playwright/prefer-locator': {
    dimension: 'locators',
    reportOnly: true,
    severityOverride: 'info',
  },

  // Structure
  'playwright/no-focused-test': { dimension: 'structure' },
  'playwright/no-skipped-test': {
    dimension: 'structure',
    severityOverride: 'warning',
  },
  'playwright/max-nested-describe': {
    dimension: 'structure',
    severityOverride: 'warning',
  },
  'playwright/require-top-level-describe': {
    dimension: 'structure',
    severityOverride: 'warning',
  },

  // Guardian custom rules
  'guardian/no-wait-for-load-state': { dimension: 'guardianConventions' },
  'guardian/no-date-now-id': { dimension: 'guardianConventions' },
  'guardian/require-expect': { dimension: 'guardianConventions' },
  'guardian/no-hardcoded-secrets': {
    dimension: 'guardianConventions',
    severityOverride: 'warning',
  },
  'guardian/require-test-step': {
    dimension: 'guardianConventions',
    severityOverride: 'warning',
  },
  'guardian/one-describe-one-test': {
    dimension: 'guardianConventions',
    severityOverride: 'warning',
  },
  'guardian/no-generic-long-timeout': {
    dimension: 'guardianConventions',
    severityOverride: 'warning',
  },

  // Metrics injected as synthetic findings
  'metrics/no-empty-test': { dimension: 'assertions' },
  'metrics/oversized-file': {
    dimension: 'structure',
    severityOverride: 'warning',
  },
};

export function mapRule(ruleId: string): RuleMapping {
  if (ESLINT_RULE_MAP[ruleId]) return ESLINT_RULE_MAP[ruleId];
  if (ruleId.startsWith('guardian/')) {
    return { dimension: 'guardianConventions', severityOverride: 'warning' };
  }
  if (ruleId.startsWith('playwright/')) {
    return { dimension: 'playwrightHygiene', severityOverride: 'warning' };
  }
  return { dimension: 'playwrightHygiene', severityOverride: 'info', reportOnly: true };
}
