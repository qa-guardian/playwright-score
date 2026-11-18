import type { Finding, Severity } from './types.js';

/**
 * How sure we are that a finding is a real problem a reader would agree
 * with. Derived from a hand check of 20 findings (QAG-288). Display and
 * ranking only: it never changes the score.
 *
 * - high:        mechanical, almost never a false positive.
 * - medium:      usually right, but there are legitimate uses.
 * - needs-check: the scorer could not resolve something; a human should look.
 */
export type Confidence = 'high' | 'medium' | 'needs-check';

export const CONFIDENCE_BY_RULE: Record<string, Confidence> = {
  'playwright/missing-playwright-await': 'high',
  'playwright/no-networkidle': 'high',
  'playwright/no-wait-for-timeout': 'high',
  'playwright/no-focused-test': 'high',
  'playwright/no-page-pause': 'high',
  'playwright-score/parse-error': 'high',
  'pwscore/no-unawaited-action': 'high',
  'pwscore/no-unawaited-expect-value': 'high',
  'pwscore/no-weak-assertion': 'high',
  'pwscore/no-fixme-test': 'high',
  'pwscore/no-excessive-timeout': 'high',
  'pwscore/no-swallowed-assertion': 'medium',
  'pwscore/no-shared-mutable-state': 'medium',
  'pwscore/no-self-fulfilling-fallback': 'needs-check',
  'pwscore/no-brittle-selector': 'needs-check',
  'pwscore/serial-mode-dependency': 'needs-check',

  'playwright-score/assertion-unverified': 'needs-check',

  'playwright/no-force-option': 'medium',
  'playwright/no-wait-for-selector': 'medium',
  'pwscore/no-timer-sleep': 'medium',
  'pwscore/no-trivial-assertion': 'medium',
  'playwright/no-conditional-in-test': 'medium',
  'playwright/no-conditional-expect': 'medium',
};

/** Display names (the Confidence values themselves never change). */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'Definite',
  medium: 'Likely',
  'needs-check': 'Not decided automatically',
};

/** Rules not listed above (and not needs-check) are medium. */
export const DEFAULT_CONFIDENCE: Confidence = 'medium';

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, 'needs-check': 2 };
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * A report-only finding normally means "ratio-scored" (the locator rules:
 * they feed the locators dimension through native/raw counts, not penalty
 * units) and is an ordinary finding. Any OTHER report-only finding is one
 * the scorer deliberately left out of the score (e.g. an assertion helper it
 * could not resolve), so it is a "not decided automatically" item.
 */
export function isNeedsCheck(f: Pick<Finding, 'reportOnly' | 'dimension'>): boolean {
  return f.reportOnly === true && f.dimension !== 'locators';
}

/**
 * Intro sentence for the "not decided automatically" block. The helper wording is
 * true only for assertion-unverified findings; any other report-only rule gets
 * a neutral sentence (QAG-287 E3).
 */
export function needsCheckIntro(findings: ReadonlyArray<Pick<Finding, 'rule'>>): { helpers: boolean } {
  return { helpers: findings.every((f) => f.rule === 'playwright-score/assertion-unverified') };
}

export function confidenceOf(f: Pick<Finding, 'rule' | 'reportOnly' | 'dimension'>): Confidence {
  if (isNeedsCheck(f)) return 'needs-check';
  return CONFIDENCE_BY_RULE[f.rule] ?? DEFAULT_CONFIDENCE;
}

export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? 3;
}

export function confidenceRank(c: Confidence): number {
  return CONFIDENCE_RANK[c];
}

/** Severity, then confidence, then file, line, rule: total and stable. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    confidenceRank(confidenceOf(a)) - confidenceRank(confidenceOf(b)) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule)
  );
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}
