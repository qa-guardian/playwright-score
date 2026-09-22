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
  // Same dimensions and weights as standard — strict changes which
  // findings count toward the score, not how the score is built. See
  // mapRule's profile-specific override below.
  strict: {
    playwrightHygiene: 40,
    assertions: 25,
    locators: 20,
    structure: 15,
  },
};

export const DEFAULT_THRESHOLDS: Record<ProfileName, number> = {
  standard: 80,
  strict: 80,
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
  // No severityOverride: matches eslint-plugin-playwright's own
  // recommended severity ('error'), set via eslint-runner.ts's rule config.
  'playwright/prefer-web-first-assertions': { dimension: 'assertions' },
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
  // playwright/no-skipped-test is turned off in eslint-runner.ts in favor
  // of pwscore/no-skipped-test-declaration, which doesn't false-positive
  // on Playwright's documented conditional test.skip(condition, reason).
  'pwscore/no-skipped-test-declaration': { dimension: 'structure' },
  'playwright/max-nested-describe': {
    dimension: 'structure',
    severityOverride: 'warning',
  },
  'playwright/require-top-level-describe': {
    dimension: 'structure',
    severityOverride: 'warning',
  },

  // Metrics injected as synthetic findings
  'metrics/oversized-file': {
    dimension: 'structure',
    severityOverride: 'warning',
  },

  // QAG-196 gameability fixes (2026-09-21) — see base-plugin.ts. Timer
  // sleeps and coordinate clicks are the same class of anti-pattern as
  // already-penalized upstream rules (no-wait-for-timeout, no-force-option)
  // and get the same full-demerit treatment. Trivial/tautological
  // assertions defeat expect-expect entirely, so they're full-demerit too.
  'pwscore/no-timer-sleep': { dimension: 'playwrightHygiene' },
  'pwscore/no-coordinate-click': { dimension: 'playwrightHygiene' },
  'pwscore/no-trivial-assertion': { dimension: 'assertions' },
  // pwscore/no-soft-assertion-only-test is intentionally NOT listed here —
  // it's contentious (soft assertions are a legitimate choice, not a
  // defect) and its reportOnly-ness depends on the active profile, which
  // a static map entry can't express. See mapRule below.
};

/**
 * `pwscore/no-soft-assertion-only-test` is the one profile-gated,
 * contentious rule (QAG-196 §8's "worth a report-only signal"): it always
 * fires so the finding is visible, but only counts toward the score under
 * `strict` — `standard` carries it as reportOnly so a deliberate,
 * legitimate use of expect.soft() throughout an audit-style test doesn't
 * cost points in the public default profile.
 */
export function mapRule(ruleId: string, profile: ProfileName = 'standard'): RuleMapping {
  if (ruleId === 'pwscore/no-soft-assertion-only-test') {
    return { dimension: 'assertions', severityOverride: 'warning', reportOnly: profile !== 'strict' };
  }
  if (ESLINT_RULE_MAP[ruleId]) return ESLINT_RULE_MAP[ruleId];
  if (ruleId.startsWith('playwright/')) {
    return { dimension: 'playwrightHygiene', severityOverride: 'warning' };
  }
  return { dimension: 'playwrightHygiene', severityOverride: 'info', reportOnly: true };
}
