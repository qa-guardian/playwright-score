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

/**
 * Scoring model v3 — "the weighted share of your tests that are clean."
 *
 * Every finding is attributed to the test it actually sits in (AST test
 * spans, resolved in index.ts). Each test accumulates demerit units for a
 * dimension — an error is a full demerit (1.0), a warning 0.4 — capped at
 * 1 per test: a test is at worst fully flawed, never more. Findings in a
 * before/after hook demerit every test in that file (setup problems affect
 * every test that runs through them); module-level findings count once per
 * file. A dimension's score is simply:
 *
 *   score = 100 × (1 − totalDemerit / tests)
 *
 * The locators dimension stays the native/(native+raw) usage ratio.
 * The final score is the weighted sum of dimensions.
 *
 * There is deliberately no per-SLOC density, no slot divisor, no minimum
 * slots, no exponential decay, and no per-rule finding caps (the per-test
 * cap of 1 is the anti-nuke mechanism, and it is also the anti-gaming
 * mechanism: padding a suite with clean lines no longer dilutes anything,
 * and padding it with fake clean tests costs assertions coverage). Earlier
 * models (≤0.4.0, published as "sqs-v1"/"sqs-v2") used density math and
 * scored e.g. a 3-test suite with two hard-wait errors, two assertion-free
 * tests, and a skipped test at 78/C; model v3 scores it 53/F, which is
 * what it is.
 */
export const MODEL = {
  scoreVersion: 'v3' as const,
  ERROR_DEMERIT: 1.0,
  WARNING_DEMERIT: 0.4,
  INFO_DEMERIT: 0.0,
  /** A single test's demerit ceiling per dimension. */
  MAX_DEMERIT_PER_TEST: 1.0,
  /** Module-level findings' demerit ceiling per (file, dimension). */
  MAX_DEMERIT_PER_FILE_MODULE: 1.0,
} as const;

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

function severityDemerit(severity: Severity): number {
  if (severity === 'error') return MODEL.ERROR_DEMERIT;
  if (severity === 'warning') return MODEL.WARNING_DEMERIT;
  return MODEL.INFO_DEMERIT;
}

/** Tests per file, keyed by the same relative file path findings carry. */
export type FileTestCounts = Record<string, number>;

interface DimensionDemerits {
  /** Σ per-test demerits (each capped at 1) + Σ per-file module demerits. */
  total: number;
  /** testKeys with any demerit > 0 in this dimension. */
  flawedTestKeys: Set<string>;
}

function demeritsForDimension(
  findings: Finding[],
  dimension: DimensionName,
  fileTests: FileTestCounts
): DimensionDemerits {
  const perTest = new Map<string, number>();
  const perFileHook = new Map<string, number>();
  const perFileModule = new Map<string, number>();

  for (const f of findings) {
    if (f.dimension !== dimension || f.reportOnly) continue;
    const d = severityDemerit(f.severity);
    if (d === 0) continue;
    if (f.scope === 'test' && f.testKey) {
      perTest.set(f.testKey, (perTest.get(f.testKey) ?? 0) + d);
    } else if (f.scope === 'hook') {
      perFileHook.set(f.file, (perFileHook.get(f.file) ?? 0) + d);
    } else {
      perFileModule.set(f.file, (perFileModule.get(f.file) ?? 0) + d);
    }
  }

  let total = 0;
  const flawedTestKeys = new Set<string>();

  // Per-test demerits: each test's own findings plus its file's hook
  // findings, capped at 1 — a test is at worst fully flawed.
  for (const [file, count] of Object.entries(fileTests)) {
    const hookUnits = perFileHook.get(file) ?? 0;
    for (let i = 0; i < count; i++) {
      const key = `${file}#${i}`;
      const units = (perTest.get(key) ?? 0) + hookUnits;
      if (units <= 0) continue;
      total += Math.min(MODEL.MAX_DEMERIT_PER_TEST, units);
      flawedTestKeys.add(key);
    }
  }
  // A test-scoped finding whose file has no counted tests (should not
  // happen, but attribution and counting are separate passes) still
  // counts, capped the same way.
  for (const [key, units] of perTest) {
    const file = key.slice(0, key.lastIndexOf('#'));
    if (fileTests[file] !== undefined) continue;
    total += Math.min(MODEL.MAX_DEMERIT_PER_TEST, units);
    flawedTestKeys.add(key);
  }
  // Hook findings in a file with zero tests (setup-only file swept in):
  // count once per file, like module scope.
  for (const [file, units] of perFileHook) {
    if ((fileTests[file] ?? 0) > 0) continue;
    total += Math.min(MODEL.MAX_DEMERIT_PER_FILE_MODULE, units);
  }
  // Module-level findings count once per file.
  for (const units of perFileModule.values()) {
    total += Math.min(MODEL.MAX_DEMERIT_PER_FILE_MODULE, units);
  }

  return { total, flawedTestKeys };
}

/**
 * 100 × (1 − demerit share). With zero tests there is nothing to take a
 * share of — module/hook demerits then act on a denominator of 1 so a
 * findings-bearing zero-test input still can't score clean.
 */
export function ratioDimensionScore(
  findings: Finding[],
  dimension: DimensionName,
  fileTests: FileTestCounts,
  tests: number
): number {
  const { total } = demeritsForDimension(findings, dimension, fileTests);
  const denominator = Math.max(tests, 1);
  const score = Math.round(100 * (1 - total / denominator));
  return Math.min(100, Math.max(0, score));
}

export function computeScore(input: {
  profile: ProfileName;
  threshold: number;
  findings: Finding[];
  sloc: number;
  files: number;
  tests: number;
  fileTests: FileTestCounts;
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
    playwrightHygiene: ratioDimensionScore(
      input.findings,
      'playwrightHygiene',
      input.fileTests,
      input.tests
    ),
    assertions: ratioDimensionScore(
      input.findings,
      'assertions',
      input.fileTests,
      input.tests
    ),
    locators: locatorsScore(input.nativeLocators, input.rawLocators),
    structure: ratioDimensionScore(
      input.findings,
      'structure',
      input.fileTests,
      input.tests
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

  // Clean tests: no demerit in any penalty dimension. (Locator usage is a
  // suite-level ratio, not a per-test property.)
  const flawed = new Set<string>();
  for (const dim of PENALTY_DIMENSIONS) {
    for (const key of demeritsForDimension(input.findings, dim, input.fileTests)
      .flawedTestKeys) {
      flawed.add(key);
    }
  }
  const cleanTests = Math.max(0, input.tests - flawed.size);

  return {
    scoreVersion: MODEL.scoreVersion,
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
        (f) => f.rule === 'playwright/expect-expect' && !f.reportOnly
      ).length,
      cleanTests,
    },
    dimensions: dims,
    findings: input.findings,
  };
}

export { PENALTY_DIMENSIONS };
