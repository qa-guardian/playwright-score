export type ScoreVersion = 'v3';
/**
 * `standard` is the stable public default. `strict` is the same rule set
 * and dimension weights, with one difference: contentious, opinionated
 * checks that `standard` only reports (no score impact) count as real
 * demerits — currently just `pwscore/no-soft-assertion-only-test`. See
 * profiles.ts/mapRule and CHANGELOG.md.
 */
export type ProfileName = 'standard' | 'strict';
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
