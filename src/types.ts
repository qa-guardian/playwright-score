import type { EngineVersions } from './engine-versions.js';
import type { Basis, Evidence, Family, Tier } from './catalogue/types.js';

export type ScoreVersion = 'v3' | 'v4' | 'v5';
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
  scope?: 'test' | 'hook' | 'module' | 'shared';
  /**
   * Set when scope === 'shared' (a finding in a shared file, reported unless
   * the `shared` option is false): the spec files that reach the file through
   * imports, sorted, in the same form as `file`.
   */
  usedBy?: string[];
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
   * when fewer than five rows were decided. `quotable` (always set by
   * `scorePaths`) is true only for a certain finding in a cell whose release
   * path in the committed precision file is M (measured); a by-construction
   * (BC), likely, advisory or needs-check finding is never quotable.
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

/**
 * Four area scores, 0-100, computed as before (src/score-engine.ts).
 * Informational since score model v5: they no longer feed the score.
 */
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
  /** Tests in state `unasserted` (see `testStates`): no assertion is reachable
   * and every call in the test was resolved. One `pwscore/unasserted` finding
   * each. (Before 3.0.0 this was the playwright/expect-expect census.) */
  unassertedTests: number;
  /** Tests with no expect(...) that call something this scan cannot read
   * (`playwright-score/assertion-unverified`, report-only). They are NOT in
   * `unassertedTests` and not penalised, but they are not known to assert. */
  unverifiedTests: number;
  /** Tests with no scored finding of any tier in any dimension (the
   * `dimensions` model). Informational since score model v5: the score is
   * built from `countedTests` and `chargedTests`, not from this count. */
  cleanTests: number;
  /** Score model v5, always set by `scorePaths`: every test except the
   * `excluded-empty` and `excluded-skipped` ones (see `testStates`). The
   * score is `round(100 x (countedTests - chargedTests) / countedTests)`.
   * (`coverage.testsCounted` keeps counting every declared test.) */
  countedTests?: number;
  /** Score model v5, always set by `scorePaths`: counted tests that are not
   * clean for the score, the `issue` tests plus, when `unassertedCharged`,
   * the `unasserted` tests. Each one names a finding or a state. */
  chargedTests?: number;
  /** Score model v5, always set by `scorePaths`: whether an `unasserted`
   * test is charged. True only when the `pwscore/unasserted` cell is
   * certain in the committed precision file; otherwise an unasserted test
   * is listed and treated like an `unverified` one (clean for the score). */
  unassertedCharged?: boolean;
}

/**
 * How much of the suite the score stands for.
 * `scored`: every file found was scored. `partial`: one or more files were
 * skipped (see `coverage.skipped`) and the score covers the rest; it does not
 * pass. `not-scored`: nothing counted toward a score (no files, every file
 * skipped, or no tests found in the scored files); the score is 0 and never a pass.
 */
export type ScoreStatus = 'scored' | 'partial' | 'not-scored';
/**
 * Why nothing was scored. `no-files`: no Playwright file was found.
 * `limit-reached`: no test was counted, and a limit of the run (`maxSeconds`
 * or `maxHeapMb`) skipped at least one file, so the suite may hold tests the
 * run did not get to. `no-counted-tests`: no test was counted, and no limit
 * was involved.
 */
export type NotScoredReason = 'no-files' | 'no-counted-tests' | 'limit-reached';
/**
 * Why a file was left out. `parse-error`: not valid JS/TS. `too-large`: over
 * the 1 MB source cap. `binary`: a NUL byte in the first 8 KB. `unreadable`:
 * the file could not be read (a broken link, a permission error). `deadline`:
 * the caller's time limit (`maxSeconds`) passed before the file was analysed.
 * `worker-died`: the analysis worker ran out of heap (`maxHeapMb`) or stopped
 * on an error while it had the file's batch. A file has one reason, the first
 * that applies in this order: `unreadable`, `too-large`, `binary`, `deadline`
 * or `worker-died`, `parse-error`.
 */
export type SkipReason = 'parse-error' | 'too-large' | 'binary' | 'unreadable' | 'deadline' | 'worker-died';

export interface SkippedFile {
  /** Relative to the same directory as `Finding.file`. */
  file: string;
  reason: SkipReason;
  /** Short machine-made detail (a size, an error code). Never a local path. */
  detail?: string;
}

export interface SharedSkippedFile {
  /** Relative to the result's `baseDir`. */
  file: string;
  reason: 'not-playwright-bound' | 'declaration-file';
}

export interface Coverage {
  /** Playwright spec files found (files of another test framework are in `skippedFiles`, not here). */
  filesFound: number;
  /** Files the score and the findings cover. */
  filesScored: number;
  /** Tests declared in the scored files (the same number as `summary.tests`). Zero means `not-scored`. */
  testsCounted: number;
  /** Files found but left out of the score, in path order. */
  skipped: SkippedFile[];
  /**
   * Shared files (page objects, fixtures, helpers the specs import) that are
   * Playwright code: the count, and the files in path order. Reported only;
   * no rule runs on them, and they never change `status`, `pass` or the score.
   */
  sharedLinted?: number;
  sharedLintedFiles?: string[];
  /**
   * Shared files that are not Playwright code (a plain utility, a
   * declaration file): the count, and the files in path order. Never a
   * reason for `partial`; `skipped` above is the list that is.
   */
  sharedSkipped?: number;
  sharedSkippedFiles?: SharedSkippedFile[];
}

/**
 * The state of one test, first match wins: `excluded-empty` (no call
 * expression in the test callback), `excluded-skipped` (declared with
 * skip/fixme, inside a skipped describe, or skipped by its first statement,
 * a `test.skip()`/`test.fixme()` with no argument or a literal `true`), `issue` (a
 * certain finding in the test or in a hook in scope for it), `unasserted` (no
 * assertion reachable, every callee resolved), `unverified` (no assertion
 * found, at least one callee not resolved), `clean`.
 */
export type TestState = 'excluded-empty' | 'excluded-skipped' | 'issue' | 'unasserted' | 'unverified' | 'clean';

/**
 * What fails the gate (`ScoreOptions.failOn`, `--fail-on`). `passes-regardless`
 * (the default): a certain finding of that family. `flake-risk`: a certain
 * finding of the flake-risk or suite family. Both count a finding in a counted
 * test, in a hook in scope for a counted test, or outside every test in a spec
 * file with at least one counted test. `unasserted`: a counted test in state
 * `unasserted` or `unverified`. `shared`: a certain finding in a shared file
 * (scope `shared`) whose `usedBy` names a spec file with a counted test.
 * `none`: no finding fails the gate; it is never combined with another value.
 */
export type FailOn = 'passes-regardless' | 'flake-risk' | 'unasserted' | 'shared' | 'none';

/**
 * Why a result does not pass: `not-scored`; `partial` (without
 * `allowPartial`); `threshold` (the score is below a given threshold); or the
 * `failOn` value whose findings or tests failed the gate.
 */
export type GateReason = 'not-scored' | 'partial' | 'threshold' | Exclude<FailOn, 'none'>;

/** How `pass` was decided (additive). */
export interface GateOutcome {
  /** The `failOn` values in effect, in a fixed order. */
  failOn: FailOn[];
  allowPartial: boolean;
  /** True when a threshold was given; without one the score does not gate. */
  thresholdApplied: boolean;
  /** Empty when `pass` is true; otherwise every reason, in a fixed order. */
  reasons: GateReason[];
}

/** Points at one finding of `findings`: the same rule, form, file, line and column. */
export interface FindingRef {
  rule: string;
  form?: string;
  file: string;
  line?: number;
  column?: number;
}

export interface TestStateEntry {
  /** Relative to `baseDir`, like `Finding.file`. */
  file: string;
  /** `${file}#${testIndex}`, the key findings carry in `testKey`. */
  testKey: string;
  /** Line of the test declaration. */
  line: number;
  state: TestState;
  /** State `unverified` only: the callees that were not resolved, sorted, at most eight. */
  unresolved?: string[];
  /** State `issue` only: every certain spec-file finding in the test or in a
   * hook in scope for it, sorted by line, column and rule. */
  chargedBy?: FindingRef[];
}

export interface ScoreResult {
  scoreVersion: ScoreVersion;
  profile: ProfileName;
  score: number;
  grade: Grade;
  /**
   * The gate (set by `scorePaths`, see `gate`): status `scored`, or `partial`
   * with `allowPartial`; no finding or test named by `failOn`; and, only when a
   * threshold was given, `score >= threshold`.
   */
  pass: boolean;
  /** The threshold given, or 0 when none was (the score then does not gate). */
  threshold: number;
  summary: ScoreSummary;
  dimensions: ScoreDimensions;
  findings: Finding[];
  /**
   * One entry per counted test, sorted by file, then line (additive; it never
   * feeds the score). See `TestState`.
   */
  testStates?: TestStateEntry[];
  /**
   * Score model v5, always set by `scorePaths`: every certain spec-file
   * finding that sits outside every test and every hook (a describe body,
   * the module top level, a spec-local `test.extend`), sorted by file, line,
   * column and rule. Such a finding belongs to no test: it changes no test
   * state and not the score.
   */
  outsideTests?: FindingRef[];
  /**
   * Score model v5, always set by `scorePaths`: the locator counts of
   * `summary`, with `scored: false`. Locator usage is reported; it does not
   * feed the score.
   */
  locators?: LocatorCounts;
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
  /** Always set by `scorePaths`: the gate settings and why the result does not pass. */
  gate?: GateOutcome;
}

export interface ScoreOptions {
  paths: string[];
  profile?: ProfileName;
  /**
   * When given, `pass` also needs `score >= threshold` (0-100). Default: none,
   * and the score does not gate (`threshold` in the result is then 0).
   */
  threshold?: number;
  /**
   * What fails the gate (see `FailOn`). Default `['passes-regardless']`. An
   * empty list, an unknown value, or `none` with another value makes
   * `scorePaths` throw a `RangeError` before any file is looked at.
   */
  failOn?: FailOn[];
  /** Lets a `partial` result pass. Default false. A `not-scored` result never passes. */
  allowPartial?: boolean;
  /** Read by the text, markdown and report formatters (they show advisory findings and needs-check reasons); no effect on the result. Default false. */
  advice?: boolean;
  cwd?: string;
  /**
   * Time limit for the whole call, in seconds, counted from the call. No
   * default: a run without it is never cut short. Finding and classifying the
   * files always finishes, so `skippedFiles` never depends on the limit. After
   * that the limit is checked before each step; once it has passed no new step
   * starts, and a batch being analysed is stopped. The files not analysed are
   * skipped (`deadline`) and the result is `partial`, or `not-scored` with
   * reason `limit-reached` when no test was counted in time. This is the only
   * limit whose effect depends on the machine. Must be a finite number above
   * 0; any other value makes `scorePaths` throw a `RangeError`.
   */
  maxSeconds?: number;
  /**
   * Heap limit of the analysis worker, in MB. Defaults to a fixed constant
   * (`DEFAULT_MAX_HEAP_MB`), never to a share of the host's memory. Must be a
   * whole number from 64 (`MIN_MAX_HEAP_MB`) to 65536 (`MAX_MAX_HEAP_MB`); any other value makes
   * `scorePaths` throw a `RangeError` before any file is looked at.
   */
  maxHeapMb?: number;
  /**
   * `false` runs the analysis in the calling thread, with no heap or time
   * limit (`maxSeconds` and `maxHeapMb` are then ignored). Default: a worker
   * thread. Both give the same result when no limit is hit.
   */
  isolate?: boolean;
}

export interface LocatorCounts {
  native: number;
  raw: number;
  /** On `ScoreResult.locators` only: always false (score model v5). */
  scored?: false;
}

export interface FileMetrics {
  file: string;
  sloc: number;
  tests: number;
  locators: LocatorCounts;
  findings: Finding[];
}
