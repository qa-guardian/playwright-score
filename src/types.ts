import type { EngineVersions } from './engine-versions.js';
import type { Basis, Evidence, Family, Tier } from './catalogue/types.js';

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
  /**
   * Catalogue fields, added after scoring and never read by it (src/catalogue).
   * `form` is the shape of the finding within its rule, decided from the
   * reported syntax node. `tier` says how far to trust it, `family` what it
   * means for the test, `basis` whether the Playwright docs or a convention
   * stand behind it. `title`, `what`, `why` and `fix` are the plain-English
   * copy; `excerpt` is the source line. `evidence` is how the scorer decided
   * what the code refers to. `confidence` is the lower end of the 95% Wilson
   * interval of the cell's decided precision on hand-checked rows, or null
   * when fewer than five rows were decided. `quotable` is true only for a
   * certain finding in a cell that passed the full release bar.
   */
  form?: string;
  tier?: Tier;
  family?: Family;
  basis?: Basis;
  docs?: string;
  title?: string;
  what?: string;
  why?: string;
  fix?: string;
  excerpt?: string;
  evidence?: Evidence;
  confidence?: number | null;
  quotable?: boolean;
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
  /** Tests with no expect(...) that call something this scan cannot read
   * (`playwright-score/assertion-unverified`, report-only). They are NOT in
   * `unassertedTests` and not penalised, but they are not known to assert. */
  unverifiedTests: number;
  /** Tests with no demerit in any dimension — the headline the score is
   * built from: the weighted share of tests that are clean. */
  cleanTests: number;
}

/**
 * How much of the suite the score stands for.
 * `scored`: every file found was scored. `partial`: one or more files were
 * skipped (see `coverage.skipped`) and the score covers the rest; it does not
 * pass. `not-scored`: nothing counted toward a score (no files, every file
 * skipped, or no counted tests); the score is 0 and never a pass.
 */
export type ScoreStatus = 'scored' | 'partial' | 'not-scored';
export type NotScoredReason = 'no-files' | 'no-counted-tests';
/**
 * Why a file was left out. `parse-error`: not valid JS/TS. `too-large`: over
 * the 1 MB source cap. `binary`: a NUL byte in the first 8 KB. `unreadable`:
 * the file could not be read (a broken link, a permission error).
 */
export type SkipReason = 'parse-error' | 'too-large' | 'binary' | 'unreadable';

export interface SkippedFile {
  /** Relative to the same directory as `Finding.file`. */
  file: string;
  reason: SkipReason;
  /** Short machine-made detail (a size, an error code). Never a local path. */
  detail?: string;
}

export interface Coverage {
  /** Playwright spec files found (files of another test framework are in `skippedFiles`, not here). */
  filesFound: number;
  /** Files the score and the findings cover. */
  filesScored: number;
  /**
   * Tests in the scored files that can run: every declared test except one
   * declared with `test.skip(...)` or `test.fixme(...)`. Zero means `not-scored`.
   */
  testsCounted: number;
  /** Files found but left out of the score, in path order. */
  skipped: SkippedFile[];
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
   * Absolute directory that every `Finding.file` is relative to (the scored
   * files' common ancestor). Lets a consumer locate source for excerpts. Local
   * to the machine that ran the scan: never put it in a shareable artifact.
   */
  baseDir?: string;
  /**
   * Files matched by a directory/glob input but skipped because they show
   * positive evidence of being a non-Playwright test (an import from
   * vitest/jest/mocha/jasmine/@testing-library, or React Testing Library's
   * screen.getBy/toBeInTheDocument() APIs). Repo-relative paths. Files passed
   * explicitly by the caller are always scored and never appear here, even
   * if they'd otherwise be skipped.
   */
  skippedFiles?: string[];
  /**
   * A playwright.config.* was found at or above a scanned directory but
   * could not be read statically (a dynamic value, e.g. `process.env`, a
   * spread, or an unsupported export shape) — discovery fell back to
   * today's filename-suffix behavior for that directory instead of acting
   * on a partial or guessed reading. See playwright-config.ts.
   */
  configWarnings?: string[];
  /**
   * Rules that threw while scoring this run (contained, so the run finished
   * but their findings may be missing). Present only when non-empty.
   */
  ruleCrashes?: Array<{ rule: string; count: number }>;
  /** Versions of the lint engine that produced this result (additive). */
  engine?: EngineVersions;
  /** Always set by `scorePaths`. Absent only on a result built by `computeScore` directly. */
  status?: ScoreStatus;
  /** Set only when `status` is `not-scored`. */
  reason?: NotScoredReason;
  /** Always set by `scorePaths`: what was found, what was scored and what was skipped. */
  coverage?: Coverage;
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
