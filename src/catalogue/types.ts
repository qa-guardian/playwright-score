import type { Confidence } from '../confidence.js';
import type { DimensionName, Severity } from '../types.js';

/** What a finding means for the test it sits in. */
export type Family = 'passes-regardless' | 'flake-risk' | 'suite' | 'maintainability';

/** Tiers a finding can carry. `needs-check` is set at run time when a premise could not be resolved; no catalogue row is born with it. */
export type Tier = 'certain' | 'likely' | 'needs-check' | 'advisory';

/**
 * How a row's tier is decided.
 * - candidate: may be certain; whether it is, is decided by labels/precision.json (src/catalogue/tiers.ts).
 * - likely / advisory: fixed by design.
 * - deleting: scheduled for deletion in 3.0.0 and reported as advisory until then.
 * - definite: the scorer's own status findings (parse error, no files).
 */
export type Design = 'candidate' | 'likely' | 'advisory' | 'deleting' | 'definite';

/** Why the rule exists: a written statement in the Playwright docs, or a convention. */
export type Basis = 'docs' | 'convention';

/** How the scorer found out what the code refers to. `name` is the only path until scope resolution lands. */
export type Evidence = 'name' | 'scope' | 'helper-call';

/**
 * One precision cell: (rule, form, file role). Spec cells only today; shared-file cells arrive with
 * shared-file linting and stay `likely` until measured.
 */
export interface RuleRow {
  rule: string;
  /** '-' when a rule has one shape. */
  form: string;
  family: Family;
  design: Design;
  /** Certain-candidate class, C1 to C13. */
  cls?: string;
  basis: Basis;
  docs?: string;
  /** Whether the by-construction path is open to this cell. Frozen with the gate spec. */
  bcEligible: boolean;
  /** For BC-eligible cells: the statement in the docs that the shape is wrong in every use. */
  docsSentence?: string;
  /** The form is part of the table but no finding carries it yet. */
  planned?: 'S3b' | 'S7c';
  title: string;
  what: string;
  why: string;
  fix: string;
  dimension: DimensionName;
  severityOverride?: Severity;
  reportOnly?: boolean;
  /** Display label used for ranking and report wording. Unchanged by the tier model. */
  label: Confidence;
  /** Not a lint rule: left out of the lint-rule map. */
  noMapping?: true;
  /** Left out of the report copy map (the report never printed copy for it). */
  noLegacyCopy?: true;
}

/** Counts of hand-checked verdicts for one cell. */
export interface VerdictCounts {
  TRUE: number;
  FALSE: number;
  DEBATABLE: number;
}

export interface CellStats {
  inSample: VerdictCounts;
  heldoutV1: VerdictCounts;
  decided: number;
  trueRows: number;
  /** TRUE / (TRUE + FALSE), or null with no decided rows. */
  precision: number | null;
  /** Lower end of the 95% Wilson interval of `precision`, or null with no decided rows. */
  wilsonLow: number | null;
  /**
   * The release path the cell passed: M (measured) or BC (by construction).
   * Written only by the evaluator's gate. Absent means no path has passed.
   */
  passedPath?: 'M' | 'BC';
}
