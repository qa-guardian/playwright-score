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

/** sqs-v1 frozen constants — change requires sqs-v2 */
export const SQS_V1 = {
  scoreVersion: 'sqs-v1' as const,
  ERROR_UNIT: 1.0,
  WARNING_UNIT: 0.4,
  INFO_UNIT: 0.0,
  MAX_FINDINGS_PER_RULE_PER_FILE: 3,
  SLOT_DIVISOR: 25,
  MIN_SLOTS: 4,
  K: 0.4,
} as const;

const PENALTY_DIMENSIONS: DimensionName[] = [
  'playwrightHygiene',
  'assertions',
  'structure',
  'guardianConventions',
];

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

function severityUnit(severity: Severity): number {
  if (severity === 'error') return SQS_V1.ERROR_UNIT;
  if (severity === 'warning') return SQS_V1.WARNING_UNIT;
  return SQS_V1.INFO_UNIT;
}

/** Cap findings per (file, rule) for penalty math only */
export function applyPerRuleCap(findings: Finding[]): Finding[] {
  const counts = new Map<string, number>();
  const out: Finding[] = [];
  for (const f of findings) {
    if (f.reportOnly) continue;
    const key = `${f.file}::${f.rule}`;
    const n = counts.get(key) ?? 0;
    if (n >= SQS_V1.MAX_FINDINGS_PER_RULE_PER_FILE) continue;
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
  const slots = Math.max(sloc / SQS_V1.SLOT_DIVISOR, SQS_V1.MIN_SLOTS);
  const load = rawUnits / slots;
  const score = Math.round(100 * Math.exp(-SQS_V1.K * load));
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
  const weights = PROFILE_WEIGHTS[input.profile];
  const dims: ScoreDimensions = {
    playwrightHygiene: penaltyDimensionScore(
      input.findings,
      'playwrightHygiene',
      input.sloc
    ),
    assertions: penaltyDimensionScore(
      input.findings,
      'assertions',
      input.sloc
    ),
    locators: locatorsScore(input.nativeLocators, input.rawLocators),
    structure: penaltyDimensionScore(
      input.findings,
      'structure',
      input.sloc
    ),
  };

  if (input.profile === 'guardian') {
    dims.guardianConventions = penaltyDimensionScore(
      input.findings,
      'guardianConventions',
      input.sloc
    );
  }

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
    scoreVersion: SQS_V1.scoreVersion,
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
    },
    dimensions: dims,
    findings: input.findings,
  };
}

export { PENALTY_DIMENSIONS };
