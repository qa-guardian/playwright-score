import type { DimensionName, ProfileName } from './types.js';

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

  // v4 (2.0.0): the four QAG-196 gameability rules and the
  // eslint-disable-comment finding are scored the same as everything
  // else above — no more report-only/profile split. See CHANGELOG.md's
  // 2.0.0 entry and METHODOLOGY.md's "Why v4".
  'pwscore/no-timer-sleep': { dimension: 'playwrightHygiene' },
  // Demoted to warning (0.4 demerit, not 1.0): page.mouse.click/move/down/
  // up(x, y) is also the *correct* way to interact with a canvas/drawing
  // surface (no addressable DOM element to target with a locator), not
  // just a brittle-DOM-app anti-pattern. Verified against the 50-repo
  // corpus: two infinite-canvas editors (tldraw, AFFiNE) accounted for
  // 428/459 of this rule's hits pre-v4. A full per-test demerit would
  // treat every legitimate canvas interaction as a full flaw; a partial
  // one still costs real points (a canvas-heavy test loses up to 0.4 per
  // dimension-capped test) without a brittle "is this a canvas app?"
  // filename/import heuristic that would itself become a new gameability
  // surface (name your test file "canvas-*" to suppress the rule).
  'pwscore/no-coordinate-click': { dimension: 'playwrightHygiene', severityOverride: 'warning' },
  'pwscore/no-trivial-assertion': { dimension: 'assertions' },
  'pwscore/no-soft-assertion-only-test': { dimension: 'assertions', severityOverride: 'warning' },
};

export function mapRule(ruleId: string): RuleMapping {
  if (ESLINT_RULE_MAP[ruleId]) return ESLINT_RULE_MAP[ruleId];
  if (ruleId.startsWith('playwright/')) {
    return { dimension: 'playwrightHygiene', severityOverride: 'warning' };
  }
  return { dimension: 'playwrightHygiene', severityOverride: 'info', reportOnly: true };
}
