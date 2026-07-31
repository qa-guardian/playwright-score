export type ScoreVersion = 'sqs-v1';
export type ProfileName = 'standard' | 'guardian';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Severity = 'error' | 'warning' | 'info';

export type DimensionName =
  | 'playwrightHygiene'
  | 'assertions'
  | 'locators'
  | 'structure'
  | 'guardianConventions';

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
}

export interface ScoreDimensions {
  playwrightHygiene: number;
  assertions: number;
  locators: number;
  structure: number;
  guardianConventions?: number;
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
