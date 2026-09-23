export type ScoreVersion = 'v3' | 'v4';
/**
 * `standard` is the only public profile, first published as of 2.0.0
 * (model v4). A separate `strict` profile was planned for 1.1.0 (never
 * published) to count the QAG-196 gameability rules toward the score
 * while `standard` only reported them; dropped before publishing once
 * `standard` started scoring them directly instead — with nothing left
 * to gate, `strict` would have been identical to `standard`. See
 * profiles.ts and CHANGELOG.md's 2.0.0 entry. `ProfileName` keeps room
 * for a future profile; a legacy `'strict'` string degrades gracefully to
 * `standard` weights via scorePaths (same fallback as the removed
 * `guardian` profile), and the CLI gives an explicit migration error.
 */
export type ProfileName = 'standard';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Severity = 'error' | 'warning' | 'info';

export type DimensionName = 'playwrightHygiene' | 'assertions' | 'locators' | 'structure';

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  file: string;
  line?: number;
  column?: number;
  dimension: DimensionName;
  /** When true, finding is listed but does not contribute penalty units */
  reportOnly?: boolean;
  /** Where the finding sits: inside a specific test ('test', with testKey),
   * inside a before/after hook ('hook' — affects every test in the file),
   * or at module level ('module' — counted once per file). Set during
   * attribution in index.ts; findings without it are treated as 'module'. */
  scope?: 'test' | 'hook' | 'module';
  /** `${file}#${testIndex}` when scope === 'test'. */
  testKey?: string;
}

export interface ScoreDimensions {
  playwrightHygiene: number;
  assertions: number;
  locators: number;
  structure: number;
}

export interface ScoreSummary {
  files: number;
  tests: number;
  sloc: number;
  findings: number;
  errors: number;
  warnings: number;
  nativeLocators: number;
  rawLocators: number;
  /** Tests with no recognized assertion (uncapped playwright/expect-expect
   * census, after delegation resolution). */
  unassertedTests: number;
  /** Tests with no demerit in any dimension — the headline the score is
   * built from: the weighted share of tests that are clean. */
  cleanTests: number;
}

export interface ScoreResult {
  scoreVersion: ScoreVersion;
  profile: ProfileName;
  score: number;
  grade: Grade;
  pass: boolean;
  threshold: number;
  summary: ScoreSummary;
  dimensions: ScoreDimensions;
  findings: Finding[];
  /**
   * Files matched by a directory/glob input but skipped because they show
   * positive evidence of being a non-Playwright test (an import from
   * vitest/jest/mocha/jasmine/@testing-library, or React Testing Library's
   * screen.getBy/toBeInTheDocument() APIs). Repo-relative paths. Files passed
   * explicitly by the caller are always scored and never appear here, even
   * if they'd otherwise be skipped.
   */
  skippedFiles?: string[];
}

export interface ScoreOptions {
  paths: string[];
  profile?: ProfileName;
  threshold?: number;
  cwd?: string;
}

export interface LocatorCounts {
  native: number;
  raw: number;
}

export interface FileMetrics {
  file: string;
  sloc: number;
  tests: number;
  locators: LocatorCounts;
  findings: Finding[];
}
