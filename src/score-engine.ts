import type {
  DimensionName,
  Finding,
  Grade,
  ProfileName,
  ScoreDimensions,
  ScoreResult,
  Severity,
} from './types.js';
import { PROFILE_WEIGHTS } from './profiles.js';

/** sqs-v2 frozen constants — change requires sqs-v3 */
export const SQS_V2 = {
  scoreVersion: 'sqs-v2' as const,
  ERROR_UNIT: 1.0,
  WARNING_UNIT: 0.4,
  INFO_UNIT: 0.0,
  MAX_FINDINGS_PER_RULE_PER_FILE: 3,
  SLOT_DIVISOR: 25,
  MIN_SLOTS: 4,
  K: 0.4,
} as const;

/** @deprecated sqs-v1 alias kept for one release so pinned callers get a
 * type-level nudge instead of a hard break; constants are identical. */
export const SQS_V1 = SQS_V2;

/**
 * The rule whose findings are, by construction, a census of "this test
 * declaration contains no recognized assertion" — one finding per test,
 * with delegation to same-file/imported helpers already resolved upstream
 * (see eslint-runner.ts's assertFunctionNames plumbing). sqs-v2 counts
 * these uncapped as the assertions-coverage numerator instead of feeding
 * them through density math.
 */
const UNASSERTED_TEST_RULE = 'playwright/expect-expect';

const PENALTY_DIMENSIONS: DimensionName[] = ['playwrightHygiene', 'assertions', 'structure'];

export function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function locatorsScore(native: number, raw: number): number {
  const total = native + raw;
  if (total === 0) return 100;
  return Math.round((100 * native) / total);
}

/**
 * sqs-v2 assertions dimension: a per-test coverage ratio, decayed by the
 * density of the remaining assertion-quality findings.
 *
 * sqs-v1 fed "test has no assertions" through the same density math as
 * hygiene smells, which misread coverage badly on small suites: 2 of 3
 * tests asserting nothing scored 82/100 on this dimension. Whether a test
 * asserts anything is a fraction of tests, not a findings-per-SLOC rate —
 * so, like the locators dimension, the primary signal is now a ratio:
 *
 *   coverage = (tests - unassertedTests) / tests      // uncapped census
 *   aux      = density load of the OTHER assertion rules
 *              (valid-expect, no-standalone-expect,
 *               prefer-web-first-assertions), capped as usual
 *   score    = round(100 * coverage * e^(-K * aux))
 *
 * expect-expect findings are excluded from the density term — they ARE the
 * coverage term, and counting them twice would double-penalize.
 * tests === 0 (nothing but helpers matched) keeps coverage at 1 and lets
 * the aux findings, if any, carry the dimension.
 */
export function assertionsScore(
  findings: Finding[],
  tests: number,
  sloc: number
): number {
  const unasserted = findings.filter(
    (f) => f.rule === UNASSERTED_TEST_RULE && !f.reportOnly
  ).length;
  const coverage =
    tests <= 0 ? 1 : Math.min(1, Math.max(0, (tests - unasserted) / tests));

  const aux = findings.filter(
    (f) => f.dimension === 'assertions' && f.rule !== UNASSERTED_TEST_RULE
  );
  const capped = applyPerRuleCap(aux);
  let rawUnits = 0;
  for (const f of capped) rawUnits += severityUnit(f.severity);
  const slots = Math.max(sloc / SQS_V2.SLOT_DIVISOR, SQS_V2.MIN_SLOTS);
  const load = rawUnits / slots;

  const score = Math.round(100 * coverage * Math.exp(-SQS_V2.K * load));
  return Math.min(100, Math.max(0, score));
}

function severityUnit(severity: Severity): number {
  if (severity === 'error') return SQS_V2.ERROR_UNIT;
  if (severity === 'warning') return SQS_V2.WARNING_UNIT;
  return SQS_V2.INFO_UNIT;
}

/** Cap findings per (file, rule) for penalty math only */
export function applyPerRuleCap(findings: Finding[]): Finding[] {
  const counts = new Map<string, number>();
  const out: Finding[] = [];
  for (const f of findings) {
    if (f.reportOnly) continue;
    const key = `${f.file}::${f.rule}`;
    const n = counts.get(key) ?? 0;
    if (n >= SQS_V2.MAX_FINDINGS_PER_RULE_PER_FILE) continue;
    counts.set(key, n + 1);
    out.push(f);
  }
  return out;
}

export function penaltyDimensionScore(
  findings: Finding[],
  dimension: DimensionName,
  sloc: number
): number {
  const dimFindings = findings.filter((f) => f.dimension === dimension);
  const capped = applyPerRuleCap(dimFindings);
  let rawUnits = 0;
  for (const f of capped) {
    rawUnits += severityUnit(f.severity);
  }
  const slots = Math.max(sloc / SQS_V2.SLOT_DIVISOR, SQS_V2.MIN_SLOTS);
  const load = rawUnits / slots;
  const score = Math.round(100 * Math.exp(-SQS_V2.K * load));
  return Math.min(100, Math.max(0, score));
}

export function computeScore(input: {
  profile: ProfileName;
  threshold: number;
  findings: Finding[];
  sloc: number;
  files: number;
  tests: number;
  nativeLocators: number;
  rawLocators: number;
}): ScoreResult {
  // Falls back to `standard`'s weights for any unrecognized profile string
  // rather than throwing — a defensive guard against exactly the failure
  // mode a profile removal creates: a caller pinned to an old contract
  // (e.g. `profile: 'guardian'`, removed in 0.2.0) degrades to a working
  // score instead of a hard crash.
  const weights = PROFILE_WEIGHTS[input.profile] ?? PROFILE_WEIGHTS.standard;
  const dims: ScoreDimensions = {
    playwrightHygiene: penaltyDimensionScore(
      input.findings,
      'playwrightHygiene',
      input.sloc
    ),
    assertions: assertionsScore(input.findings, input.tests, input.sloc),
    locators: locatorsScore(input.nativeLocators, input.rawLocators),
    structure: penaltyDimensionScore(
      input.findings,
      'structure',
      input.sloc
    ),
  };

  let score = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    const key = dim as keyof ScoreDimensions;
    const value = dims[key];
    if (value === undefined) continue;
    score += (weight / 100) * value;
  }
  score = Math.round(score);

  const errors = input.findings.filter((f) => f.severity === 'error').length;
  const warnings = input.findings.filter((f) => f.severity === 'warning').length;

  return {
    scoreVersion: SQS_V2.scoreVersion,
    profile: input.profile,
    score,
    grade: gradeFromScore(score),
    pass: score >= input.threshold,
    threshold: input.threshold,
    summary: {
      files: input.files,
      tests: input.tests,
      sloc: input.sloc,
      findings: input.findings.length,
      errors,
      warnings,
      nativeLocators: input.nativeLocators,
      rawLocators: input.rawLocators,
      unassertedTests: input.findings.filter(
        (f) => f.rule === UNASSERTED_TEST_RULE && !f.reportOnly
      ).length,
    },
    dimensions: dims,
    findings: input.findings,
  };
}

export { PENALTY_DIMENSIONS };
